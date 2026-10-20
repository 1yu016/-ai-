import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsOptional, IsString, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';

export class DialogueMessageDto {
  @IsIn(['user', 'assistant']) role: 'user' | 'assistant';
  @IsString() @MinLength(1) @MaxLength(600) content: string;
}
export class ClassroomDialogueDto {
  @IsString() @MinLength(1) @MaxLength(100) requestId: string;
  @Type(() => Number) @IsInt() @Min(0) stepIndex: number;
  @IsString() @MinLength(1) @MaxLength(300) text: string;
  @IsOptional() @IsArray() @ArrayMaxSize(8) @ValidateNested({ each: true }) @Type(() => DialogueMessageDto)
  history: DialogueMessageDto[] = [];
}
