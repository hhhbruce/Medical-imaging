/* NEXUS 主页入口配置 — 换环境只改本文件，页面结构不用动。
 * 键名对应 index.html 中元素的 data-link 属性；
 * 由 app.js 的 wireLinks() 写入 href，并统一以新标签页打开。
 *
 * 当前为本地开发直连地址。迁移到 nginx 同源部署（挂载 /home/）时只改这里：
 *   workbench: '/'                        （OHIF 工作台与主页同源）
 *   pacs:      '/pacs/app/explorer.html'  （经 /pacs/ 代理访问 Orthanc Explorer，需实测跳转）
 *   lab:       改为研究空间的实际部署地址
 */
window.NEXUS_LINKS = {
  /* 进入工作台：与研究空间「打开研究空间」一致，指向 localhost:3000 */
  workbench: 'http://localhost:3000/',
  /* 中间件后台：Orthanc Explorer（PACS 检查/实例管理）— docker-compose 的 orthanc */
  pacs: 'http://localhost:8042/',
  /* 研究空间：本地研究服务 */
  lab: 'http://localhost:3000/'
};
