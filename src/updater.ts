/**
 * 自动更新模块（已被安全禁用，彻底杜绝代码覆盖）
 */

// 1. 拦截远程版本查询
export async function getRemoteVersion(): Promise<string | null> {
    return null;
}

// 2. 伪装本地版本为绝对最大值
export async function getLocalVersion(): Promise<string> {
    return '999.0.0';
}

// 3. 版本对比永远返回不需要更新
export function compareVersions(): boolean {
    return false;
}

// 4. 自动更新入口：调用即瞬间返回，不发任何网络请求
export async function checkAndUpdate(): Promise<void> {
    return;
}

// 5. 手动更新入口：调用即瞬间返回，不发任何网络请求
export async function performUpdate(): Promise<void> {
    return;
}
