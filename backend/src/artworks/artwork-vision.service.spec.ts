import { BadGatewayException } from '@nestjs/common';
import { ArtworkVisionService } from './artwork-vision.service';

describe('ArtworkVisionService safety parser', () => {
  const service = Object.create(ArtworkVisionService.prototype) as ArtworkVisionService;

  it('accepts only visible, structured observations', () => {
    expect(service.parse(JSON.stringify({
      visibleSubject: '一棵树和太阳', colors: ['绿色', '黄色'], composition: '太阳在画面上方',
      visibleElements: ['树', '太阳'], creativeExpression: '用弯曲线条表现树枝', details: ['树下有小花'], openQuestion: '你愿意说说树下发生了什么吗？',
    }))).toMatchObject({ visibleSubject: '一棵树和太阳' });
  });

  it.each(['心理诊断为焦虑', '这个孩子智力很高', '从画面看家庭贫困', '识别出作者姓名'])('rejects forbidden inference: %s', (visibleSubject) => {
    expect(() => service.parse(JSON.stringify({
      visibleSubject, colors: [], composition: '', visibleElements: [], creativeExpression: '', details: [], openQuestion: '你画了什么？',
    }))).toThrow(BadGatewayException);
  });

  it('rejects model-added fields', () => {
    expect(() => service.parse(JSON.stringify({
      visibleSubject: '太阳', colors: [], composition: '', visibleElements: [], creativeExpression: '', details: [], openQuestion: '为什么选择黄色？', identity: '小明',
    }))).toThrow('越权字段');
  });
});
