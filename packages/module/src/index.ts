// packages/module/src/index.ts —— @proteus/module 公共入口（module-plan B1：模块契约）
// 导出：defineModule（契约声明 + 编译期校验）+ validateModuleConfig（纯校验）+ 扫描/汇总（CLI module:check）
export { defineModule, validateModuleConfig } from './contract'
export type { ModuleConfig, ModuleValidationIssue, ModuleValidationResult } from './contract'
export { walkModuleConfigs, loadModuleConfig, scanModuleConfigs, formatModuleCheck } from './scan'
export type { ModuleScanEntry, ModuleScanResult } from './scan'
