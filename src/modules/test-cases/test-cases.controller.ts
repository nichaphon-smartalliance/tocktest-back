import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  Query,
  Res,
  BadRequestException,
} from '@nestjs/common';
import type { Response } from 'express';
import { TestCasesService } from './test-cases.service';
import { TestExportService } from './test-export.service';
import { CreateTestCaseDto, UpdateTestCaseDto, BulkSaveTestCasesDto } from './dto/create-test-case.dto';
import { CreateFolderDto, UpdateFolderDto } from './dto/create-folder.dto';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { User } from '../users/entities/user.entity';

@Controller('api/v1/repositories')
export class TestCasesController {
  constructor(
    private readonly service: TestCasesService,
    private readonly exportService: TestExportService,
  ) {}

  // ── Folders ───────────────────────────────────────────────────────────

  @Get(':repoId/folders')
  getFolders(@CurrentUser() user: User, @Param('repoId') repoId: string) {
    return this.service.getFolders(user.id, repoId);
  }

  @Post(':repoId/folders')
  createFolder(
    @CurrentUser() user: User,
    @Param('repoId') repoId: string,
    @Body() dto: CreateFolderDto,
  ) {
    return this.service.createFolder(user.id, repoId, dto);
  }

  @Put(':repoId/folders/:folderId')
  updateFolder(
    @CurrentUser() user: User,
    @Param('repoId') repoId: string,
    @Param('folderId') folderId: string,
    @Body() dto: UpdateFolderDto,
  ) {
    return this.service.updateFolder(user.id, repoId, folderId, dto);
  }

  @Delete(':repoId/folders/:folderId')
  deleteFolder(
    @CurrentUser() user: User,
    @Param('repoId') repoId: string,
    @Param('folderId') folderId: string,
  ) {
    return this.service.deleteFolder(user.id, repoId, folderId);
  }

  // ── Test Cases ────────────────────────────────────────────────────────

  @Get(':repoId/test-cases/export')
  async exportTestCases(
    @CurrentUser() user: User,
    @Param('repoId') repoId: string,
    @Query('framework') framework: string,
    @Query('ids') ids: string,
    @Res() res: Response,
  ) {
    const idList = ids ? ids.split(',').filter(Boolean) : [];
    const repo = await this.service.getRepoForExport(user.id, repoId);
    const testCases = await this.service.findAllForExport(user.id, repoId, idList);
    const content = this.exportService.generateCypress(repo.fullName, testCases);
    const filename = `${repo.fullName.replace('/', '_')}.cy.ts`;
    res.setHeader('Content-Type', 'text/typescript; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(content);
  }

  @Post(':repoId/test-cases/bulk')
  bulkSave(
    @CurrentUser() user: User,
    @Param('repoId') repoId: string,
    @Body() dto: BulkSaveTestCasesDto,
  ) {
    return this.service.bulkSave(user.id, repoId, dto);
  }

  @Get(':repoId/test-cases')
  findAll(
    @CurrentUser() user: User,
    @Param('repoId') repoId: string,
    @Query() pagination: PaginationDto,
    @Query('folderId') folderId?: string,
    @Query('status') status?: string,
    @Query('testType') testType?: string,
    @Query('priority') priority?: string,
    @Query('search') search?: string,
  ) {
    return this.service.findAll(user.id, repoId, { ...pagination, folderId, status, testType, priority, search });
  }

  @Get(':repoId/test-cases/:id')
  findOne(
    @CurrentUser() user: User,
    @Param('repoId') repoId: string,
    @Param('id') id: string,
  ) {
    return this.service.findOne(user.id, repoId, id);
  }

  @Post(':repoId/test-cases')
  create(
    @CurrentUser() user: User,
    @Param('repoId') repoId: string,
    @Body() dto: CreateTestCaseDto,
  ) {
    return this.service.create(user.id, repoId, dto);
  }

  @Put(':repoId/test-cases/:id')
  update(
    @CurrentUser() user: User,
    @Param('repoId') repoId: string,
    @Param('id') id: string,
    @Body() dto: UpdateTestCaseDto,
  ) {
    return this.service.update(user.id, repoId, id, dto);
  }

  @Delete(':repoId/test-cases/:id')
  delete(
    @CurrentUser() user: User,
    @Param('repoId') repoId: string,
    @Param('id') id: string,
  ) {
    return this.service.delete(user.id, repoId, id);
  }
}
