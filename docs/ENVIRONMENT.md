# 环境变量说明

| 变量 | 必需 | 用途 |
| --- | --- | --- |
| `PORT` | 否 | 后端端口，默认 3000 |
| `DATABASE_PATH` | 生产必填 | SQLite 文件绝对路径 |
| `JWT_SECRET` | 是 | JWT 签名密钥，必须使用高强度随机值 |
| `JWT_EXPIRES_IN` | 否 | Token 有效期 |
| `ARK_API_KEY` | 是 | 火山方舟 API 密钥 |
| `ARK_ENDPOINT_ID` | 是 | 模型端点 ID |
| `AI_REQUEST_TIMEOUT_MS` | 否 | AI 请求超时毫秒数 |
| `RESOURCE_UPLOAD_ROOT_PATH` | 推荐 | `/uploads` 静态根目录 |
| `RESOURCE_UPLOAD_PATH` | 推荐 | 实际资源上传目录，通常为静态根目录下的 `resources` |
| `RESOURCE_LIBRARY_PATH` | 否 | 旧版只读资源库目录 |
| `GARDEN_SHARED_OWNER_ID` | 否 | 园所共享资源所有者标识 |
| `PUBLIC_RATE_TTL_MS` | 否 | 公共接口限流窗口 |
| `PUBLIC_RATE_LIMIT` | 否 | 限流窗口内请求数 |
| `VITE_API_BASE_URL` | 否 | 前端调用后端的基础地址 |

测试环境还可设置 `TEST_TEACHER_ACCOUNT`、`TEST_TEACHER_PASSWORD` 和 `TEST_TEACHER_NAME`。示例文件只能放占位值，严禁写入真实密钥。
