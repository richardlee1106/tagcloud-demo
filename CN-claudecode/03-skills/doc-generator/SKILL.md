---
name: api-documentation-generator
description: Generate comprehensive, accurate API documentation from source code. Use when creating or updating API documentation, generating OpenAPI specs, or when users mention API docs, endpoints, or documentation.
---

# API Documentation Generator Skill（API 文档生成器技能）

## Generates（生成内容）

- OpenAPI/Swagger 规范
- API 端点文档
- SDK 使用示例
- 集成指南
- 错误代码参考
- 认证指南

## Documentation Structure（文档结构）

### For Each Endpoint（每个端点）

```markdown
## GET /api/v1/users/:id

### Description（描述）
Brief explanation of what this endpoint does（端点功能的简要说明）

### Parameters（参数）

| Name（名称） | Type（类型） | Required（必需） | Description（描述） |
|------|------|----------|-------------|
| id | string | Yes | User ID（用户 ID） |

### Response（响应）

**200 Success（成功）**
```json
{
  "id": "usr_123",
  "name": "John Doe",
  "email": "john@example.com",
  "created_at": "2025-01-15T10:30:00Z"
}
```

**404 Not Found（未找到）**
```json
{
  "error": "USER_NOT_FOUND",
  "message": "User does not exist"
}
```

### Examples（示例）

**cURL**
```bash
curl -X GET "https://api.example.com/api/v1/users/usr_123" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**JavaScript**
```javascript
const user = await fetch('/api/v1/users/usr_123', {
  headers: { 'Authorization': 'Bearer token' }
}).then(r => r.json());
```

**Python**
```python
response = requests.get(
    'https://api.example.com/api/v1/users/usr_123',
    headers={'Authorization': 'Bearer token'}
)
user = response.json()
```
