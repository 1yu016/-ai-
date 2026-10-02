import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  ConsentStatus,
  ConsentType,
  DeviceStatus,
  DeviceType,
  RecordStatus,
  TeacherClassRole,
} from '../platform.types';
import { AccountStatus, TeacherRole } from '../../auth/entities/teacher.entity';

export class PageQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 20;
}

/** Stage 7.3：班级成长奖励历史查询，支持按幼儿筛选。 */
export class ClassRewardQueryDto extends PageQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) studentId?: number;
}

export class DeviceCodeParamDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  deviceCode: string;
}

export class ClassQueryDto extends PageQueryDto {
  @IsOptional() @IsEnum(RecordStatus) status?: RecordStatus;
}

export class CreateClassDto {
  @IsString() @IsNotEmpty() @MaxLength(100) name: string;
  @IsOptional() @IsString() @MaxLength(50) grade?: string;
  @IsOptional() @IsString() @MaxLength(50) ageRange?: string;
  @IsString() @IsNotEmpty() @MaxLength(20) schoolYear: string;
  @IsOptional() @IsString() @MaxLength(64) schoolId?: string;
}

export class UpdateClassDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(100) name?: string;
  @IsOptional() @IsString() @MaxLength(50) grade?: string;
  @IsOptional() @IsString() @MaxLength(50) ageRange?: string;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(20) schoolYear?: string;
  @IsOptional() @IsEnum(RecordStatus) status?: RecordStatus;
}

export class BindTeacherDto {
  @Type(() => Number) @IsInt() @Min(1) teacherId: number;
  @IsEnum(TeacherClassRole) role: TeacherClassRole;
}

export class StudentQueryDto extends PageQueryDto {
  @Type(() => Number) @IsInt() @Min(1) classId: number;
  @IsOptional() @IsEnum(RecordStatus) status?: RecordStatus;
}

export class CreateStudentDto {
  @Type(() => Number) @IsInt() @Min(1) classId: number;
  @IsString() @IsNotEmpty() @MaxLength(64) studentNo: string;
  @IsString() @IsNotEmpty() @MaxLength(100) name: string;
  @IsOptional() @IsString() @MaxLength(100) nickname?: string;
  @IsOptional() @IsString() @MaxLength(20) gender?: string;
  @IsOptional() @IsDateString() birthday?: string;
}

export class UpdateStudentDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(100) name?: string;
  @IsOptional() @IsString() @MaxLength(100) nickname?: string;
  @IsOptional() @IsString() @MaxLength(20) gender?: string;
  @IsOptional() @IsDateString() birthday?: string;
  @IsOptional() @IsEnum(RecordStatus) status?: RecordStatus;
}

export class SyncStudentItemDto {
  @IsString() @IsNotEmpty() @MaxLength(64) studentNo: string;
  @IsString() @IsNotEmpty() @MaxLength(100) name: string;
  @IsOptional() @IsString() @MaxLength(100) nickname?: string;
  @IsOptional() @IsString() @MaxLength(20) gender?: string;
  @IsOptional() @IsDateString() birthday?: string;
  @IsOptional() @IsEnum(RecordStatus) status?: RecordStatus;
}

export class SyncStudentsDto {
  @Type(() => Number) @IsInt() @Min(1) classId: number;
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => SyncStudentItemDto)
  students: SyncStudentItemDto[];
}

export class CreateClassroomDto {
  @IsString() @IsNotEmpty() @MaxLength(100) name: string;
  @IsOptional() @IsString() @MaxLength(255) location?: string;
  @IsOptional() @IsString() @MaxLength(64) schoolId?: string;
}

export class UpdateClassroomDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(100) name?: string;
  @IsOptional() @IsString() @MaxLength(255) location?: string;
  @IsOptional() @IsEnum(RecordStatus) status?: RecordStatus;
}

export class CreateDeviceDto {
  @IsString() @IsNotEmpty() @MaxLength(100) deviceCode: string;
  @IsString() @IsNotEmpty() @MaxLength(100) name: string;
  @IsEnum(DeviceType) type: DeviceType;
  @IsOptional() @IsString() @MaxLength(64) schoolId?: string;
}

export class UpdateDeviceDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(100) name?: string;
  @IsOptional() @IsEnum(DeviceType) type?: DeviceType;
  @IsOptional() @IsEnum(DeviceStatus) status?: DeviceStatus;
}

export class BindDeviceDto {
  @Type(() => Number) @IsInt() @Min(1) deviceId: number;
  @Type(() => Number) @IsInt() @Min(1) classroomId: number;
  @Type(() => Number) @IsInt() @Min(1) classId: number;
}

export class CreateTicketDto {
  @Type(() => Number) @IsInt() @Min(1) deviceId: number;
  @Type(() => Number) @IsInt() @Min(1) classId: number;
  @Type(() => Number) @IsInt() @Min(1) classroomId: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) lessonRunId?: number;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(30)
  @Max(600)
  expiresInSeconds = 120;
}

export class ConsumeTicketDto {
  @IsString() @IsNotEmpty() @MaxLength(512) ticket: string;
  @IsString() @IsNotEmpty() @MaxLength(100) deviceCode: string;
}

export class UpsertConsentDto {
  @Type(() => Number) @IsInt() @Min(1) studentId: number;
  @IsEnum(ConsentType) consentType: ConsentType;
  @IsEnum(ConsentStatus) status: ConsentStatus;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class ConsentQueryDto {
  @Type(() => Number) @IsInt() @Min(1) studentId: number;
}

export class TeacherQueryDto extends PageQueryDto {
  @IsOptional() @IsString() @MaxLength(64) keyword?: string;
  @IsOptional() @IsEnum(AccountStatus) status?: AccountStatus;
}

export class CreateTeacherDto {
  @IsString() @IsNotEmpty() @MaxLength(64) account: string;
  @IsString() @IsNotEmpty() @MaxLength(128) password: string;
  @IsString() @IsNotEmpty() @MaxLength(100) name: string;
  @IsOptional() @IsEnum(TeacherRole) role?: TeacherRole;
  @IsOptional() @IsString() @MaxLength(64) schoolId?: string;
}

export class UpdateTeacherDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(100) name?: string;
  @IsOptional() @IsEnum(TeacherRole) role?: TeacherRole;
  @IsOptional() @IsEnum(AccountStatus) status?: AccountStatus;
}
