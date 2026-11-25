export interface SampleProfile {
  filename: string;
  name: string;
  note: string;
  imageUrl: string;
}

export const SAMPLE_PROFILES: SampleProfile[] = [
  {
    filename: '陈默.jpg',
    name: '陈默',
    note: '产品设计组',
    imageUrl: '/src/assets/images/sample_chen_mo_1795645493680.jpg',
  },
  {
    filename: '林知夏.jpg',
    name: '林知夏',
    note: '视觉研发部',
    imageUrl: '/src/assets/images/sample_lin_zhixia_1795645494538.jpg',
  },
  {
    filename: '周明远.jpg',
    name: '周明远',
    note: '工程架构部',
    imageUrl: '/src/assets/images/sample_zhou_mingyuan_1795645495423.jpg',
  },
  {
    filename: '苏晚晴.jpg',
    name: '苏晚晴',
    note: '客户运营组',
    imageUrl: '/src/assets/images/sample_su_wanqing_1795645495608.jpg',
  },
];
