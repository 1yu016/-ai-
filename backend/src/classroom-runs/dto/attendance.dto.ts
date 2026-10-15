import { IsString, MaxLength, MinLength } from 'class-validator';

export class VoiceAttendanceCandidatesDto {
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  transcript: string;
}
