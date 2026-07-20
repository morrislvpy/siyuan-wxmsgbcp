import { renderMessageFolderPath, renderFolderPath } from '../src/settings/template';
import { DEFAULT_SETTINGS, PluginSettings } from '../src/settings/index';
import { Article } from '../src/utils/types';

const article: Article = {
    id: 'message-001',
    title: '同步助手_20260324',
    content: '测试消息',
    url: 'https://example.com/message',
    savedAt: '2026-03-24T14:30:45.000Z',
};

function createSettings(overrides: Partial<PluginSettings> = {}): PluginSettings {
    return { ...DEFAULT_SETTINGS, ...overrides };
}

describe('renderMessageFolderPath', () => {
    test('消息路径为空时回退到文章文件夹路径', () => {
        const settings = createSettings({ messageFolder: '' });

        expect(renderMessageFolderPath(article, settings)).toBe(renderFolderPath(article, settings));
    });

    test('支持年月原子时间变量', () => {
        const settings = createSettings({
            messageFolder: '微信/{{{year}}}/{{{month}}}',
        });

        expect(renderMessageFolderPath(article, settings)).toBe('微信/2026/03');
    });

    test('使用消息路径专属日期格式渲染 date 变量', () => {
        const monthlySettings = createSettings({
            messageFolder: '消息/{{{date}}}',
            messageFolderDateFormat: 'yyyy-MM',
        });
        const dailySettings = createSettings({
            messageFolder: '消息/{{{date}}}',
            messageFolderDateFormat: 'yyyy-MM-dd',
        });

        expect(renderMessageFolderPath(article, monthlySettings)).toBe('消息/2026-03');
        expect(renderMessageFolderPath(article, dailySettings)).toBe('消息/2026-03-24');
    });

    test('规范化首尾和重复斜杠', () => {
        const settings = createSettings({
            messageFolder: '/msg//{{{year}}}/',
        });

        expect(renderMessageFolderPath(article, settings)).toBe('msg/2026');
    });
});
