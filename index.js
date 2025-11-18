const XLSX = require('xlsx');
const JiraClient = require('jira-client');
const config = require('./config');
const colors = require('colors');

// Initialize Jira client
const jira = new JiraClient({
    protocol: config.jira.protocol,
    host: config.jira.host.replace('https://', '').replace('http://', ''),
    username: config.jira.email,
    password: config.jira.apiToken,
    apiVersion: config.jira.apiVersion,
    strictSSL: config.jira.strictSSL
});

// Read Excel file
function readExcelFile(filePath) {
    console.log(colors.cyan(`📖 Đang đọc file: ${filePath}`));

    const workbook = XLSX.readFile(filePath);
    const sheetName = config.excel.sheetName;

    if (!workbook.SheetNames.includes(sheetName)) {
        throw new Error(`Sheet "${sheetName}" không tồn tại. Các sheet có sẵn: ${workbook.SheetNames.join(', ')}`);
    }

    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(worksheet);

    console.log(colors.green(`✓ Đọc thành công ${data.length} dòng từ sheet "${sheetName}"`));
    return data;
}

// Group data by parent task
function groupByParentTask(data) {
    console.log(colors.cyan('📊 Đang nhóm dữ liệu theo task cha...'));

    const grouped = {};
    const cols = config.excel.columns;

    data.forEach((row, index) => {
        const taskName = row[cols.task];

        if (!taskName) {
            console.log(colors.yellow(`⚠ Bỏ qua dòng ${index + 2}: Thiếu tên TASK`));
            return;
        }

        if (!grouped[taskName]) {
            grouped[taskName] = {
                taskName: taskName,
                description: row[cols.description] || '',
                subTasks: []
            };
        }

        // Add sub-task if exists
        const subTaskName = row[cols.subTask];
        if (subTaskName) {
            grouped[taskName].subTasks.push({
                name: subTaskName,
                description: row[cols.descSubTask] || '',
                point: row[cols.point] || 0
            });
        }
    });

    const taskCount = Object.keys(grouped).length;
    const subTaskCount = Object.values(grouped).reduce((sum, task) => sum + task.subTasks.length, 0);

    console.log(colors.green(`✓ Tìm thấy ${taskCount} task cha và ${subTaskCount} sub-task`));
    return grouped;
}

// Create parent task on Jira
async function createParentTask(taskData) {
    try {
        // Tính tổng story points từ sub-tasks
        const totalPoints = taskData.subTasks.reduce((sum, subTask) => {
            const point = parseFloat(subTask.point) || 0;
            return sum + point;
        }, 0);

        const issue = {
            fields: {
                project: {
                    key: config.jira.projectKey
                },
                summary: taskData.taskName,
                description: taskData.description,
                issuetype: {
                    name: config.issueTypes.parent
                }
            }
        };

        // Add story points cho parent task
        if (totalPoints > 0) {
            const fieldId = process.env.STORY_POINTS_FIELD_ID || 'customfield_10016';
            issue.fields[fieldId] = totalPoints;
        }

        console.log(colors.cyan(`  → Đang tạo task cha: "${taskData.taskName}" (${totalPoints} points)`));
        const result = await jira.addNewIssue(issue);
        console.log(colors.green(`  ✓ Tạo thành công: ${result.key}`));
        return result;
    } catch (error) {
        console.error(colors.red(`  ✗ Lỗi khi tạo task cha: ${error.message}`));
        throw error;
    }
}

// Create sub-task on Jira
async function createSubTask(parentKey, subTaskData) {
    try {
        const issue = {
            fields: {
                project: {
                    key: config.jira.projectKey
                },
                parent: {
                    key: parentKey  // ← Thêm parent key
                },
                summary: subTaskData.name,
                description: subTaskData.description,
                issuetype: {
                    name: config.issueTypes.child
                }
            }
        };

        // Add story points if exists
        if (subTaskData.point && subTaskData.point > 0) {
            try {
                // Thử các field ID phổ biến cho Story Points
                const storyPointsFieldId = process.env.STORY_POINTS_FIELD_ID || 'customfield_10016';
                issue.fields[storyPointsFieldId] = parseFloat(subTaskData.point);
            } catch (e) {
                console.log(colors.yellow(`    ⚠ Không thể set story points: ${e.message}`));
            }
        }

        console.log(colors.cyan(`    → Đang tạo task: "${subTaskData.name}" (${subTaskData.point} points)`));
        const result = await jira.addNewIssue(issue);
        console.log(colors.green(`    ✓ Tạo thành công: ${result.key} (sub-task of ${parentKey})`));

        return result;
    } catch (error) {
        console.error(colors.red(`    ✗ Lỗi khi tạo task: ${error.message}`));
        // Continue with other sub-tasks
        return null;
    }
}

// Main process
async function processExcelToJira(filePath) {
    try {
        console.log(colors.bold.blue('\n🚀 BẮT ĐẦU XỬ LÝ\n'));

        // Validate config
        if (!config.jira.host || !config.jira.email || !config.jira.apiToken || !config.jira.projectKey) {
            throw new Error('Vui lòng cấu hình đầy đủ thông tin Jira trong file .env');
        }

        // Read Excel
        const data = readExcelFile(filePath);

        if (data.length === 0) {
            console.log(colors.yellow('⚠ File Excel không có dữ liệu'));
            return;
        }

        // Group data
        const groupedData = groupByParentTask(data);

        console.log(colors.bold.blue('\n📝 BẮT ĐẦU TẠO TASKS TRÊN JIRA\n'));

        let successCount = 0;
        let errorCount = 0;

        // Process each parent task
        for (const [taskName, taskData] of Object.entries(groupedData)) {
            try {
                console.log(colors.bold(`\n[${successCount + errorCount + 1}/${Object.keys(groupedData).length}] ${taskName}`));

                // Create parent task
                const parentIssue = await createParentTask(taskData);

                // Create sub-tasks
                if (taskData.subTasks.length > 0) {
                    console.log(colors.cyan(`  Đang tạo ${taskData.subTasks.length} tasks...`));

                    for (const subTask of taskData.subTasks) {
                        await createSubTask(parentIssue.key, subTask);
                        // Add delay to avoid rate limiting
                        await new Promise(resolve => setTimeout(resolve, 500));
                    }
                }

                successCount++;
            } catch (error) {
                errorCount++;
                console.error(colors.red(`\n✗ Lỗi xử lý task "${taskName}": ${error.message}\n`));
            }
        }

        // Summary
        console.log(colors.bold.blue('\n' + '='.repeat(50)));
        console.log(colors.bold.green(`✓ HOÀN THÀNH`));
        console.log(colors.green(`  Thành công: ${successCount} tasks`));
        if (errorCount > 0) {
            console.log(colors.red(`  Lỗi: ${errorCount} tasks`));
        }
        console.log(colors.bold.blue('='.repeat(50) + '\n'));

    } catch (error) {
        console.error(colors.bold.red(`\n❌ LỖI: ${error.message}\n`));
        process.exit(1);
    }
}

// Run
const args = process.argv.slice(2);
if (args.length === 0) {
    console.log(colors.yellow('\n⚠ Cách sử dụng: node index.js <đường-dẫn-file-excel>\n'));
    console.log(colors.cyan('Ví dụ: node index.js tasks.xlsx\n'));
    process.exit(1);
}

const filePath = args[0];
processExcelToJira(filePath);
