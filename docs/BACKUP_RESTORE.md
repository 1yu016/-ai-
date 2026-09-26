# 备份与恢复

## 备份

1. 暂停写入或使用 SQLite 在线备份机制取得一致快照。
2. 备份 `DATABASE_PATH` 指向的 SQLite 文件。
3. 同步备份 `RESOURCE_UPLOAD_ROOT_PATH`，保持文件路径结构不变。
4. 对数据库和上传目录分别记录时间、大小和校验值。
5. 将备份存放到访问受控且加密的位置。

## 恢复演练

```bash
cd backend
BACKUP_SOURCE=/absolute/path/app.sqlite npm run backup:verify
```

校验脚本把数据库复制到系统临时目录，以只读方式执行 `PRAGMA integrity_check` 并检查核心表，随后删除临时副本。正式恢复时应在停机状态下恢复数据库和上传目录，启动后检查登录、资源读取、教案和课堂记录。不要在运行中的生产数据库上直接覆盖文件。
