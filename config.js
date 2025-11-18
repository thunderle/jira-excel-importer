require('dotenv').config();

module.exports = {
  jira: {
    host: process.env.JIRA_HOST,
    email: process.env.JIRA_EMAIL,
    apiToken: process.env.JIRA_API_TOKEN,
    projectKey: process.env.JIRA_PROJECT_KEY,
    protocol: 'https',
    apiVersion: '2',
    strictSSL: true
  },
  excel: {
    sheetName: process.env.SHEET_NAME || 'Sheet1',
    columns: {
      task: 'TASK',
      description: 'DESCRIPTION',
      type: 'TYPE',
      subTask: 'SUB-TASK',
      descSubTask: 'SUB-TASK DESC',
      point: 'SUB-TASK POINT'
    }
  },
  issueTypes: {
    parent: process.env.DEFAULT_TASK_TYPE || 'Story',
    child: process.env.DEFAULT_SUBTASK_TYPE || 'Sub-task'
  }
};
