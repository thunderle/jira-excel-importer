const XLSX = require('xlsx');
const JiraClient = require('jira-client');
const config = require('./config');
const colors = require('colors');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

// Initialize Jira client
const jira = new JiraClient({
    protocol: config.jira.protocol,
    host: config.jira.host.replace('https://', '').replace('http://', ''),
    username: config.jira.email,
    password: config.jira.apiToken,
    apiVersion: config.jira.apiVersion,
    strictSSL: config.jira.strictSSL
});

function createReadline() {
    return readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });
}

function askQuestion(rl, question) {
    return new Promise(resolve => rl.question(question, answer => resolve(answer)));
}

function listExcelFilesInCwd() {
    const cwd = process.cwd();
    const files = fs.readdirSync(cwd, { withFileTypes: true })
        .filter(d => d.isFile())
        .map(d => d.name)
        .filter(name => {
            const ext = path.extname(name).toLowerCase();
            return ext === '.xlsx' || ext === '.xls';
        })
        .sort((a, b) => a.localeCompare(b));

    return files.map(name => path.join(cwd, name));
}

async function promptSelectFromList(title, items, formatItem = (v) => v) {
    if (!items || items.length === 0) {
        throw new Error(`${title}: Không có lựa chọn nào.`);
    }

    console.log(colors.bold.cyan(`\n${title}`));
    items.forEach((item, idx) => {
        console.log(colors.cyan(`  ${idx + 1}) ${formatItem(item)}`));
    });

    const rl = createReadline();
    try {
        while (true) {
            const answer = (await askQuestion(rl, colors.yellow('Chọn số (ví dụ 1): '))).trim();
            const n = Number(answer);
            if (Number.isInteger(n) && n >= 1 && n <= items.length) {
                return items[n - 1];
            }
            console.log(colors.red(`Giá trị không hợp lệ. Vui lòng nhập số từ 1 đến ${items.length}.`));
        }
    } finally {
        rl.close();
    }
}

function normalizeHeader(v) {
    return String(v ?? '').trim().toUpperCase();
}

function validateWorksheetStructureAndData(worksheet) {
    const cols = config.excel.columns;

    // 1) Validate headers existence (structure)
    const rowsAsArray = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });
    if (!rowsAsArray || rowsAsArray.length === 0) {
        throw new Error('Sheet rỗng (không có header).');
    }

    const headerRow = rowsAsArray[0].map(normalizeHeader).filter(Boolean);
    if (headerRow.length === 0) {
        throw new Error('Không tìm thấy header (dòng đầu trống).');
    }

    // BẮT BUỘC đủ cột theo cấu trúc
    const requiredHeaders = [
        cols.task,
        cols.description,
        cols.type,
        cols.subTask,
        cols.descSubTask,
        cols.point
    ].map(normalizeHeader);

    const missingHeaders = requiredHeaders.filter(h => !headerRow.includes(h));
    if (missingHeaders.length > 0) {
        throw new Error(
            `Sheet thiếu cột bắt buộc: ${missingHeaders.join(', ')}. ` +
            `Các cột hiện có: ${headerRow.join(', ')}`
        );
    }

    // 2) Validate required data (row-level)
    const data = XLSX.utils.sheet_to_json(worksheet, { defval: '' });

    if (data.length === 0) {
        throw new Error('Sheet không có dữ liệu (không có dòng nào sau header).');
    }

    const errors = [];
    const warnings = [];
    let validRowCount = 0;

    data.forEach((row, idx) => {
        const excelRowNumber = idx + 2; // +2 because row 1 is header
        const taskName = String(row[cols.task] ?? '').trim();

        // Nếu không có TASK thì bỏ qua hoàn toàn (không validate, không warning/error)
        if (!taskName) return;

        validRowCount++;

        const subTaskName = String(row[cols.subTask] ?? '').trim();
        const subTaskDesc = String(row[cols.descSubTask] ?? '').trim();
        const pointRaw = row[cols.point];

        // Có SUB-TASK nhưng thiếu SUB-TASK DESC -> chỉ cảnh báo
        if (subTaskName && !subTaskDesc) {
            warnings.push(
                `Dòng ${excelRowNumber}: Có "${cols.subTask}" nhưng thiếu "${cols.descSubTask}" ` +
                `(sẽ tạo sub-task với description rỗng)`
            );
        }

        // Point nếu có thì phải là số hợp lệ và >= 0
        const pointStr = String(pointRaw ?? '').trim();
        if (pointStr !== '') {
            const n = Number(pointStr);
            if (!Number.isFinite(n) || n < 0) {
                errors.push(`Dòng ${excelRowNumber}: "${cols.point}" không hợp lệ (phải là số >= 0)`);
            }
        }
    });

    if (validRowCount === 0) {
        throw new Error(`Sheet không có dòng hợp lệ để xử lý (tất cả dòng đều thiếu "${cols.task}").`);
    }

    if (warnings.length > 0) {
        const preview = warnings.slice(0, 20);
        const more = warnings.length > preview.length ? `\n... và ${warnings.length - preview.length} cảnh báo khác` : '';
        console.log(colors.yellow(`⚠ CẢNH BÁO DỮ LIỆU:\n- ${preview.join('\n- ')}${more}\n`));
    }

    if (errors.length > 0) {
        const preview = errors.slice(0, 20);
        const more = errors.length > preview.length ? `\n... và ${errors.length - preview.length} lỗi khác` : '';
        throw new Error(`Dữ liệu Excel không hợp lệ:\n- ${preview.join('\n- ')}${more}`);
    }

    return data;
}

// Read Excel file (by selected sheetName) + validate
function readExcelFile(filePath, sheetName) {
    console.log(colors.cyan(`📖 Đang đọc file: ${filePath}`));

    const workbook = XLSX.readFile(filePath);

    if (!workbook.SheetNames.includes(sheetName)) {
        throw new Error(`Sheet "${sheetName}" không tồn tại. Các sheet có sẵn: ${workbook.SheetNames.join(', ')}`);
    }

    const worksheet = workbook.Sheets[sheetName];

    console.log(colors.cyan(`🔎 Đang validate dữ liệu sheet "${sheetName}"...`));
    const data = validateWorksheetStructureAndData(worksheet);

    console.log(colors.green(`✓ Dữ liệu hợp lệ. Số dòng: ${data.length}`));
    return data;
}


// Read Excel file (by selected sheetName)
// function readExcelFile(filePath, sheetName) {
//     console.log(colors.cyan(`📖 Đang đọc file: ${filePath}`));
//
//     const workbook = XLSX.readFile(filePath);
//
//     if (!workbook.SheetNames.includes(sheetName)) {
//         throw new Error(`Sheet "${sheetName}" không tồn tại. Các sheet có sẵn: ${workbook.SheetNames.join(', ')}`);
//     }
//
//     const worksheet = workbook.Sheets[sheetName];
//     const data = XLSX.utils.sheet_to_json(worksheet);
//
//     console.log(colors.green(`✓ Đọc thành công ${data.length} dòng từ sheet "${sheetName}"`));
//     return data;
// }

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
async function processExcelToJira(filePath, sheetName) {
    try {
        console.log(colors.bold.blue('\n🚀 BẮT ĐẦU XỬ LÝ\n'));

        // Validate config
        if (!config.jira.host || !config.jira.email || !config.jira.apiToken || !config.jira.projectKey) {
            throw new Error('Vui lòng cấu hình đầy đủ thông tin Jira trong file .env');
        }

        // Read Excel
        const data = readExcelFile(filePath, sheetName);

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

async function runInteractiveIfNeeded(args) {
    // Backward-compatible:
    // - If user passes file path, keep old behavior (use configured sheetName)
    // - If no args: interactive select file + sheet
    if (args.length > 0) {
        const filePath = args[0];
        const sheetName = config.excel.sheetName;
        await processExcelToJira(filePath, sheetName);
        return;
    }

    const excelFiles = listExcelFilesInCwd();
    if (excelFiles.length === 0) {
        console.log(colors.yellow('\n⚠ Không tìm thấy file Excel (.xlsx/.xls) trong thư mục hiện tại.\n'));
        console.log(colors.cyan('Gợi ý: đặt file Excel cùng thư mục với tool, hoặc chạy: node index.js <đường-dẫn-file-excel>\n'));
        process.exit(1);
    }

    const selectedFile = await promptSelectFromList(
        '📁 Chọn file Excel trong thư mục hiện tại:',
        excelFiles,
        (fp) => path.basename(fp)
    );

    const workbook = XLSX.readFile(selectedFile);
    const sheetNames = workbook.SheetNames || [];
    const selectedSheet = await promptSelectFromList(
        '🧾 Chọn sheet để import:',
        sheetNames,
        (s) => s
    );

    await processExcelToJira(selectedFile, selectedSheet);
}

// Run
const args = process.argv.slice(2);
runInteractiveIfNeeded(args);
