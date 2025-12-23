# Jira Excel Importer Tool

Tool tự động đọc file Excel và tạo tasks/sub-tasks trên Jira.

## 📋 Yêu cầu

- Node.js v14 trở lên
- Tài khoản Jira với API Token

## 🚀 Cài đặt

### 1. Cài đặt dependencies
```bash
npm install
```

### 2. Tạo Jira API Token

1. Truy cập: https://id.atlassian.com/manage-profile/security/api-tokens
2. Click "Create API token"
3. Copy token

### 3. Cấu hình

Copy file `.env.example` thành `.env`:
```bash
cp .env.example .env
```

Điền thông tin vào file `.env`:

```env
JIRA_HOST=https://your-company.atlassian.net
JIRA_EMAIL=your-email@company.com
JIRA_API_TOKEN=your-api-token-here
JIRA_PROJECT_KEY=PROJ (ví dụ mã task là ON-21006. Thì project key là ON )
SHEET_NAME=Sheet1
```

## 📊 Cấu trúc file Excel

File Excel cần có các cột sau:

| TASK | DESCRIPTION | TYPE | SUB-TASK | SUB-TASK DESC | SUB-TASK POINT |
|------|-------------|------|----------|--------------|-------|
| Tích hợp thanh toán | Tích hợp VNPay | Story | Thiết kế API | Thiết kế endpoints | 3 |
| Tích hợp thanh toán | Tích hợp VNPay | Story | Viết unit test | Test edge cases | 5 |
| Fix bug login | Sửa lỗi đăng nhập | Bug | Kiểm tra session | Kiểm tra session timeout | 2 |

**Lưu ý:**
- Các dòng có cùng `TASK` sẽ được nhóm thành 1 task cha với nhiều sub-tasks
- Cột `TYPE` hiện tại không được sử dụng
- `POINT` là Story Points của sub-task

## ▶️ Chạy tool
```bash
node index.js
```

## 🔧 Troubleshooting

### Lỗi: "customfield_10016 not found"
Field Story Points có thể có ID khác. Tìm field ID:
- Settings → Issues → Custom fields → Story Points
- Sửa trong file `index.js` dòng: `customfield_10016`

### Lỗi: "Authentication failed"
- Kiểm tra JIRA_EMAIL và JIRA_API_TOKEN
- Đảm bảo API Token còn hiệu lực
