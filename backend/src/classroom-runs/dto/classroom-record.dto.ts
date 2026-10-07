import {
  ArrayMaxSize,
  IsArray,
  IsOptional,
  IsString,
  Length,
  MaxLength,
} from 'class-validator';

export class ConfirmClassroomSummaryDto {
  @IsString()
  @Length(1, 2000)
  classroomSummary: string;

  @IsString()
  @Length(1, 2000)
  participation: string;

  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(300, { each: true })
  interestPoints: string[];

  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(300, { each: true })
  commonQuestions: string[];

  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(500, { each: true })
  teachingStrategies: string[];
}

export class DiscardClassroomSummaryDto {
  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;
}
