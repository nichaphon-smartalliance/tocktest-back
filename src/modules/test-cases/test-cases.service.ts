import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull, In } from 'typeorm';
import { TestCase } from './entities/test-case.entity';
import { TestCaseFolder } from './entities/test-case-folder.entity';
import { RepositoriesService } from '../repositories/repositories.service';
import { toPageResult } from '../../common/dto/pagination.dto';
import type { CreateTestCaseDto, UpdateTestCaseDto, BulkSaveTestCasesDto } from './dto/create-test-case.dto';
import type { CreateFolderDto, UpdateFolderDto } from './dto/create-folder.dto';

@Injectable()
export class TestCasesService {
  constructor(
    @InjectRepository(TestCase)
    private readonly tcRepo: Repository<TestCase>,
    @InjectRepository(TestCaseFolder)
    private readonly folderRepo: Repository<TestCaseFolder>,
    private readonly repoService: RepositoriesService,
  ) {}

  // ── Folders ───────────────────────────────────────────────────────────

  async getFolders(userId: string, repoId: string): Promise<TestCaseFolder[]> {
    const repoIds = await this.repoService.getSharedRepoIds(userId, repoId);
    return this.folderRepo.find({
      where: { repoId: In(repoIds), parentId: IsNull() },
      relations: ['children', 'children.children'],
      order: { orderIndex: 'ASC', name: 'ASC' },
    });
  }

  async createFolder(userId: string, repoId: string, dto: CreateFolderDto): Promise<TestCaseFolder> {
    await this.repoService.findOneForUser(userId, repoId);
    if (dto.parentId) await this.assertFolderBelongsToRepo(repoId, dto.parentId);
    const folder = this.folderRepo.create({
      repoId,
      name: dto.name,
      parentId: dto.parentId ?? null,
    });
    return this.folderRepo.save(folder);
  }

  async updateFolder(userId: string, repoId: string, folderId: string, dto: UpdateFolderDto): Promise<TestCaseFolder> {
    const repoIds = await this.repoService.getSharedRepoIds(userId, repoId);
    const folder = await this.folderRepo.findOne({ where: { id: folderId, repoId: In(repoIds) } });
    if (!folder) throw new NotFoundException('Folder not found');
    folder.name = dto.name;
    return this.folderRepo.save(folder);
  }

  async deleteFolder(userId: string, repoId: string, folderId: string): Promise<void> {
    const repoIds = await this.repoService.getSharedRepoIds(userId, repoId);
    const folder = await this.folderRepo.findOne({ where: { id: folderId, repoId: In(repoIds) } });
    if (!folder) throw new NotFoundException('Folder not found');
    await this.folderRepo.remove(folder);
  }

  // ── Test Cases ────────────────────────────────────────────────────────

  async findAll(userId: string, repoId: string, params: {
    folderId?: string;
    status?: string;
    testType?: string;
    priority?: string;
    search?: string;
    page?: number;
    pageSize?: number;
  }) {
    const repoIds = await this.repoService.getSharedRepoIds(userId, repoId);
    const { folderId, status, testType, priority, search, page = 1, pageSize = 20 } = params;

    const qb = this.tcRepo.createQueryBuilder('tc').where('tc.repoId IN (:...repoIds)', { repoIds });

    if (folderId) qb.andWhere('tc.folderId = :folderId', { folderId });
    if (status) qb.andWhere('tc.status = :status', { status });
    if (testType) qb.andWhere('tc.testType = :testType', { testType });
    if (priority) qb.andWhere('tc.priority = :priority', { priority });
    if (search) qb.andWhere('tc.title ILIKE :search', { search: `%${search}%` });

    qb.orderBy('tc.createdAt', 'DESC').skip((page - 1) * pageSize).take(pageSize);

    const [items, total] = await qb.getManyAndCount();
    return toPageResult(items, total, page, pageSize);
  }

  async findOne(userId: string, repoId: string, id: string): Promise<TestCase> {
    const repoIds = await this.repoService.getSharedRepoIds(userId, repoId);
    const tc = await this.tcRepo.findOne({ where: { id, repoId: In(repoIds) } });
    if (!tc) throw new NotFoundException('Test case not found');
    return tc;
  }

  async create(userId: string, repoId: string, dto: CreateTestCaseDto): Promise<TestCase> {
    await this.repoService.findOneForUser(userId, repoId);
    if (dto.folderId) await this.assertFolderBelongsToRepo(repoId, dto.folderId);
    const tc = this.tcRepo.create({ ...dto, repoId, createdBy: userId });
    return this.tcRepo.save(tc);
  }

  async update(userId: string, repoId: string, id: string, dto: UpdateTestCaseDto): Promise<TestCase> {
    const tc = await this.findOne(userId, repoId, id);
    if (dto.folderId) await this.assertFolderBelongsToRepo(repoId, dto.folderId);
    Object.assign(tc, dto);
    return this.tcRepo.save(tc);
  }

  async delete(userId: string, repoId: string, id: string): Promise<void> {
    const tc = await this.findOne(userId, repoId, id);
    await this.tcRepo.remove(tc);
  }

  async bulkSave(userId: string, repoId: string, dto: BulkSaveTestCasesDto): Promise<TestCase[]> {
    await this.repoService.findOneForUser(userId, repoId);
    const folderIds = [...new Set(dto.testCases.map((tc) => tc.folderId).filter((id): id is string => !!id))];
    for (const folderId of folderIds) await this.assertFolderBelongsToRepo(repoId, folderId);
    const items = dto.testCases.map((tc) =>
      this.tcRepo.create({ ...tc, repoId, createdBy: userId, isAiGenerated: true }),
    );
    return this.tcRepo.save(items);
  }

  private async assertFolderBelongsToRepo(repoId: string, folderId: string): Promise<void> {
    const folder = await this.folderRepo.findOne({ where: { id: folderId, repoId } });
    if (!folder) throw new NotFoundException('Folder not found');
  }

}
