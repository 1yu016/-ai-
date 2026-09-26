import { ConfigService } from '@nestjs/config';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Repository } from 'typeorm';
import type { TeachingResource } from '../data/entities/teaching-resource.entity';
import { ResourceService } from './resource.service';

describe('ResourceService', () => {
  let directory: string;
  let service: ResourceService;

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'kindergarten-resources-'));
    await writeFile(
      join(directory, '《小兔子乖乖》 [BV14K411i7ac].mp3'),
      Buffer.from('test-audio'),
    );
    const configService = {
      get: (name: string) =>
        name === 'RESOURCE_LIBRARY_PATH' ? directory : undefined,
    } as ConfigService;
    service = new ResourceService(
      configService,
      {} as Repository<TeachingResource>,
    );
  });

  afterAll(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('lists audio files with curated kindergarten metadata', async () => {
    await expect(service.list()).resolves.toEqual([
      expect.objectContaining({
        id: 'BV14K411i7ac',
        title: '小兔子乖乖',
        category: '歌曲音乐',
        mediaType: 'audio',
        aliases: expect.arrayContaining(['小兔子']),
      }),
    ]);
  });

  it('turns a natural-language play request into a real resource action', async () => {
    const result = await service.handleCommand('帮我打开小兔子乖乖这首歌');

    expect(result?.reply).toBe('已为你播放《小兔子乖乖》。');
    expect(result?.action).toEqual(
      expect.objectContaining({
        type: 'play',
        resource: expect.objectContaining({ id: 'BV14K411i7ac' }),
      }),
    );
  });

  it('does not intercept ordinary conversation', async () => {
    await expect(
      service.handleCommand('小兔子喜欢吃什么？'),
    ).resolves.toBeNull();
  });
});
