/**
 * Static demo content for the preparation mind-map panel.
 *
 * There is no mind-map endpoint (and none is planned), so this module is a
 * plain data asset, not an API client. Editing a node stays local to the
 * browser session; nothing here is persisted.
 */

export interface MindMapBranch {
  id: string
  label: string
  /** 主题色 hex */
  color: string
  leaves: string[]
}

export interface MindMapData {
  title: string
  center: string
  branches: MindMapBranch[]
}

export const defaultMindMap: MindMapData = {
  title: '高等数学·微分学思维导图',
  center: '高等数学·微分学',
  branches: [
    {
      id: 'b1',
      label: '极限与连续',
      color: '#4d94ff',
      leaves: ['数列与函数极限', '无穷小与无穷大', '两个重要极限', '连续与间断点'],
    },
    {
      id: 'b2',
      label: '导数与微分',
      color: '#9b7ef4',
      leaves: ['导数的定义', '求导法则', '高阶导数', '微分与近似计算'],
    },
    {
      id: 'b3',
      label: '中值定理',
      color: '#f2a93b',
      leaves: ['罗尔定理', '拉格朗日中值定理', '柯西中值定理', '洛必达法则'],
    },
    {
      id: 'b4',
      label: '积分学',
      color: '#4cb051',
      leaves: ['不定积分公式', '换元积分法', '分部积分法', '定积分与反常积分'],
    },
    {
      id: 'b5',
      label: '综合应用',
      color: '#ef6f9e',
      leaves: ['单调性与极值', '切线与渐近线', '微分方程初步', '级数敛散性判别'],
    },
  ],
}

export function buildMindMapTemplate(topic: string): MindMapData {
  return {
    title: `${topic}思维导图`,
    center: topic,
    branches: [
      {
        id: 't1',
        label: '基础概念',
        color: '#4d94ff',
        leaves: ['核心定义', '基本术语', '概念辨析', '知识框架'],
      },
      {
        id: 't2',
        label: '重点难点',
        color: '#9b7ef4',
        leaves: ['高频考点', '易混淆点', '深层原理', '常见误区'],
      },
      {
        id: 't3',
        label: '方法技巧',
        color: '#f2a93b',
        leaves: ['通用解题步骤', '记忆口诀', '快速判断技巧', '答题模板'],
      },
      {
        id: 't4',
        label: '典型例题',
        color: '#4cb051',
        leaves: ['基础示例', '进阶示例', '真题节选', '变式训练'],
      },
      {
        id: 't5',
        label: '应用拓展',
        color: '#ef6f9e',
        leaves: ['跨章知识关联', '实际情境应用', '综合题型', '延伸阅读'],
      },
    ],
  }
}
