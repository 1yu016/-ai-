import { Column, Index } from 'typeorm';
import { OwnerType } from '../owner.types';

export abstract class OwnedEntity {
  @Index()
  @Column({
    name: 'owner_type',
    type: 'simple-enum',
    enum: OwnerType,
  })
  ownerType: OwnerType;

  @Index()
  @Column({ name: 'owner_id', type: 'varchar', length: 128 })
  ownerId: string;
}
