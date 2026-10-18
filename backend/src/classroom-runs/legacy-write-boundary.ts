import { ConflictException } from '@nestjs/common';

export function rejectLegacyWrite(operation: string): never {
  throw new ConflictException({ code: 'LEGACY_SEMANTICS_UNSUPPORTED', operation,
    message: '此旧写入语义尚未适配；历史数据仍可读取，请使用正式课堂入口。' });
}

export type RecordSource = 'canonical' | 'legacy_participation' | 'legacy_engagement';
export function withRecordIdentity<T extends { id: number }>(record: T, source: RecordSource, recordType: string) {
  return { ...record, ...(!Object.prototype.hasOwnProperty.call(record, 'source') ? { source } : {}),
    recordSource: source, recordType, recordId: record.id,
    recordIdentity: { source, recordType, recordId: record.id }, identity: `${source}/${recordType}/${record.id}` };
}
