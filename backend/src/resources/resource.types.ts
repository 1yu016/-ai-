export const PERSONAL_RESOURCE_CATEGORIES = [
  '歌曲音乐',
  '故事绘本',
  '视频动画',
  '教案课件',
  '图片卡片',
  '游戏活动',
  '手工美术',
  '练习材料',
] as const;

export type PersonalResourceCategory =
  (typeof PERSONAL_RESOURCE_CATEGORIES)[number];

export type ResourceMediaType =
  'audio' | 'video' | 'image' | 'document' | 'presentation' | 'other';

export type PersonalResource = {
  id: string;
  title: string;
  fileName: string;
  category: PersonalResourceCategory;
  subcategory?: string;
  aliases: string[];
  ageGroups: string[];
  domains: string[];
  themes: string[];
  mediaType: ResourceMediaType;
  contentUrl: string;
};

export type ResourceCommandAction = {
  type: 'play';
  resource: PersonalResource;
};

export type ResourceCommandResult = {
  reply: string;
  action?: ResourceCommandAction;
};
