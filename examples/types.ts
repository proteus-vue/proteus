// examples/types.ts —— app 模块公共契约：types（module-plan B1）
// 仅类型定义（铁律：业务逻辑禁止进 exports）
export interface AppConfig {
  platform: 'web' | 'mp'
}
