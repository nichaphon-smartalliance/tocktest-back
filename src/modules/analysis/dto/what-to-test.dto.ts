import { ArrayNotEmpty, IsArray, IsString } from 'class-validator';

export class WhatToTestDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  commitShas: string[];
}
