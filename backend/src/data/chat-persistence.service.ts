import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import type { DataOwner } from './owner.types';
import { ChatMessage, ChatMessageRole } from './entities/chat-message.entity';
import { ChatSession } from './entities/chat-session.entity';

export type SaveChatInput = {
  sessionId?: number;
  text: string;
  reply: string;
};

@Injectable()
export class ChatPersistenceService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(ChatSession)
    private readonly sessionRepository: Repository<ChatSession>,
  ) {}

  async saveExchange(owner: DataOwner, input: SaveChatInput): Promise<number> {
    return this.dataSource.transaction(async (manager) => {
      const sessionRepository = manager.getRepository(ChatSession);
      const messageRepository = manager.getRepository(ChatMessage);
      let session: ChatSession;

      if (input.sessionId) {
        const existing = await sessionRepository.findOne({
          where: {
            id: input.sessionId,
            ownerType: owner.ownerType,
            ownerId: owner.ownerId,
          },
        });
        if (!existing) {
          throw new NotFoundException('会话不存在或不属于当前用户');
        }
        session = existing;
      } else {
        session = sessionRepository.create({
          ...owner,
          title: input.text.trim().slice(0, 30),
          lastActiveAt: new Date(),
        });
      }

      session.lastActiveAt = new Date();
      session = await sessionRepository.save(session);
      await messageRepository.save([
        messageRepository.create({
          ...owner,
          sessionId: session.id,
          role: ChatMessageRole.User,
          content: input.text,
        }),
        messageRepository.create({
          ...owner,
          sessionId: session.id,
          role: ChatMessageRole.Assistant,
          content: input.reply,
        }),
      ]);

      return session.id;
    });
  }

  async sessionBelongsToOwner(
    sessionId: number,
    owner: DataOwner,
  ): Promise<boolean> {
    return this.sessionRepository.exists({
      where: { id: sessionId, ...owner },
    });
  }
}
