// Parcel (Plasmo 底层打包器) 的 data-text: scheme —— 把文件内容作为字符串导入。
// 用于把 styles/ui.css 注入到 popup / tabs 各页面。
declare module "data-text:*" {
  const content: string
  export default content
}
