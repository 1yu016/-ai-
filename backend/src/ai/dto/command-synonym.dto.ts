import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';
import { ClassroomCommandOperation } from '../../classroom-runs/classroom-command.types';

export const CUSTOM_COMMAND_OPERATIONS = [
  ClassroomCommandOperation.PreviousStep,
  ClassroomCommandOperation.NextStep,
  ClassroomCommandOperation.PauseMedia,
  ClassroomCommandOperation.ResumeMedia,
  ClassroomCommandOperation.StopMedia,
  ClassroomCommandOperation.PreviousPage,
  ClassroomCommandOperation.NextPage,
  ClassroomCommandOperation.ZoomIn,
  ClassroomCommandOperation.ZoomOut,
  ClassroomCommandOperation.Mute,
  ClassroomCommandOperation.Unmute,
  ClassroomCommandOperation.RandomRollCall,
  ClassroomCommandOperation.StartBreak,
  ClassroomCommandOperation.EndBreak,
  ClassroomCommandOperation.CompleteClass,
] as const;

export class CreateCommandSynonymDto {
  @IsString()
  @MinLength(2)
  @MaxLength(40)
  phrase: string;

  @IsIn(CUSTOM_COMMAND_OPERATIONS)
  operation: (typeof CUSTOM_COMMAND_OPERATIONS)[number];
}
