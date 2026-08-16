'use strict';

/**
 * Steam 0.9.0 官方插件套装快照。
 * WebUI 渲染不出动态键，因此勾选框必须是静态字段；本表是唯一清单。
 */
const STEAM_OFFICIAL_PACKS = [
    {
        id: 'app_launcher',
        title: '应用启动器',
        extra: '打开软件、开机自启等副作用条目仍被拦住。'
    },
    {
        id: 'bilibili_danmaku',
        title: 'B站弹幕监听',
        extra: '房间号、Cookie 仍在 N.E.K.O 自己的设置里。'
    },
    {
        id: 'bilibili_dm',
        title: 'B站私信',
        extra: '发私信类条目是 B0，勾选不会放行发送。'
    },
    {
        id: 'claude_companion',
        title: 'Claude 伙伴陪伴',
        extra: '独立 LLM / Key 相关条目若被分成 C5 则仍不可见。'
    },
    {
        id: 'galgame_plugin',
        title: 'Galgame游玩助手',
        extra: '键鼠、点击等副作用条目仍被拦住。'
    },
    {
        id: 'game_agent_minecraft',
        title: 'Minecraft 游戏插件',
        extra: '建造、攻击等自动游玩副作用条目仍被拦住。WS 端口在 N.E.K.O 设置里。'
    },
    {
        id: 'lifekit',
        title: '生活助手',
        extra: ''
    },
    {
        id: 'mcp_adapter',
        title: 'MCP Adapter（勾了也不会暴露）',
        blocked: true,
        extra: '本格只为目录完整。勾选无效，Hub 会忽略。该插件是 C5/adapter，永远不会暴露给主 LLM。'
    },
    {
        id: 'memo_reminder',
        title: '备忘提醒',
        extra: '写提醒若被判 B0 则仍不可见。'
    },
    {
        id: 'mijia',
        title: '米家智能家居',
        extra: '账号在 N.E.K.O；控制类可能是 B0，勾选不会放行。'
    },
    {
        id: 'music_pusher',
        title: '汐音阁',
        extra: '推歌或改配置若被判 B0 则仍不可见。'
    },
    {
        id: 'neko_live',
        title: 'NEKO Live',
        extra: '直播推流相关。账号与房间仍在 N.E.K.O 设置里。'
    },
    {
        id: 'neko_warthunder',
        title: '战雷猫娘副驾驶',
        extra: '战雷遥测端口在 N.E.K.O；操作类是 B0，勾选不会放行。'
    },
    {
        id: 'proactive_controller',
        title: '主动搭话控制器',
        extra: '改主动搭话频率/模式的条目仍按 C2/B0 分级，只放行 C2。'
    },
    {
        id: 'qq_auto_reply',
        title: 'QQ集成',
        extra: '发消息等副作用条目仍被拦住。登录态在 N.E.K.O。'
    },
    {
        id: 'sts2_autoplay',
        title: '杀戮尖塔 2 游戏插件',
        extra: '自动游玩、操作等副作用条目仍被拦住。'
    },
    {
        id: 'study_companion',
        title: 'Study Companion',
        extra: '学习面板工具较多，仍只放行 C2。'
    },
    {
        id: 'web_search',
        title: '网络搜索（肥牛已有搜索，不建议勾）',
        fixture: true,
        extra: '肥牛已有搜索工具。这是 N.E.K.O 的网络搜索夹具，不建议勾选。勾选后才把该插件的 C2 工具交给主 LLM。'
    },
    {
        id: 'wechat_integration',
        title: '微信集成',
        extra: '发消息等副作用条目仍被拦住。登录态在 N.E.K.O。'
    }
].map((pack) => ({
    ...pack,
    field: `pack_${pack.id}`,
    blocked: Boolean(pack.blocked),
    fixture: Boolean(pack.fixture)
}));

function packFieldName(pluginId) {
    return `pack_${pluginId}`;
}

function listPackFieldNames() {
    return STEAM_OFFICIAL_PACKS.map((pack) => pack.field);
}

function listBlockedPackIds() {
    return STEAM_OFFICIAL_PACKS.filter((pack) => pack.blocked).map((pack) => pack.id);
}

function listFixturePackIds() {
    return STEAM_OFFICIAL_PACKS.filter((pack) => pack.fixture).map((pack) => pack.id);
}

function readPackFlags(cfg) {
    const flags = {};
    const source = cfg && typeof cfg === 'object' ? cfg : {};
    for (const pack of STEAM_OFFICIAL_PACKS) {
        flags[pack.id] = source[pack.field] === true;
    }
    return flags;
}

function listCheckedPackIds(cfg) {
    const flags = readPackFlags(cfg);
    return STEAM_OFFICIAL_PACKS
        .filter((pack) => flags[pack.id] === true && !pack.blocked)
        .map((pack) => pack.id);
}

function shouldLiftFixture(pluginId, packFlags) {
    return pluginId === 'web_search' && Boolean(packFlags && packFlags.web_search);
}

function defaultPackDescription(pack) {
    if (pack.blocked) {
        return pack.extra || '本格只为目录完整。勾选无效，Hub 会忽略。';
    }
    const toolHint = `勾选后，肥牛主 LLM 会看到该 Steam 插件下所有分级为 C2 的工具（neko__${pack.id}__<entry_id>）。不会因本勾选放行 B0/C3/C4/C5。账号、Cookie、房间号、游戏端口仍在 N.E.K.O 自己的设置里，不在肥牛里。默认关闭。`;
    if (pack.extra) {
        return `${toolHint} ${pack.extra}`.trim();
    }
    return toolHint;
}

module.exports = {
    STEAM_OFFICIAL_PACKS,
    packFieldName,
    listPackFieldNames,
    listBlockedPackIds,
    listFixturePackIds,
    readPackFlags,
    listCheckedPackIds,
    shouldLiftFixture,
    defaultPackDescription
};
