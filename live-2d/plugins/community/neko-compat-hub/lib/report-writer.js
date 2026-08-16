'use strict';

const fs = require('fs');
const path = require('path');

function countByLevel(rows) {
    const counts = { C0: 0, C1: 0, C2: 0, C3: 0, C4: 0, C5: 0, B0: 0 };
    for (const row of rows || []) {
        if (counts[row.level] !== undefined) counts[row.level] += 1;
    }
    return counts;
}

function buildMarkdown(report) {
    const lines = [];
    lines.push('# N.E.K.O Compatibility Hub 报告');
    lines.push('');
    lines.push(`- 生成时间: ${report.generated_at}`);
    lines.push(`- Hub 状态: ${report.hub_state}`);
    lines.push(`- Runtime 端口: ${report.port || '(未启动)'}`);
    lines.push(`- Runtime 版本: ${report.tag || '-'} / ${report.commit || '-'}`);
    lines.push(`- Python: ${report.python_version || '-'}`);
    lines.push(`- 发现插件: ${report.plugin_count}`);
    lines.push(`- 发现条目: ${report.entry_count}`);
    lines.push(`- 已授权: ${report.approved_count}`);
    lines.push(`- 已注册工具: ${report.registered_count}`);
    lines.push(`- 已勾选套装: ${(report.enabled_packs && report.enabled_packs.length) ? report.enabled_packs.join(',') : '无'}`);
    lines.push(`- 注册后回读确认: ${report.confirmed_count}`);
    lines.push(`- 撞名拒绝: ${report.rejected_count}`);
    lines.push('');
    lines.push('## 分级统计');
    lines.push('');
    const counts = report.level_counts || {};
    lines.push(`C0=${counts.C0 || 0} C1=${counts.C1 || 0} C2=${counts.C2 || 0} C3=${counts.C3 || 0} C4=${counts.C4 || 0} C5=${counts.C5 || 0} B0=${counts.B0 || 0}`);
    lines.push('');
    lines.push('## 条目明细');
    lines.push('');
    lines.push('| plugin | entry | level | rule | authorized | tool | reason |');
    lines.push('| --- | --- | --- | --- | --- | --- | --- |');
    for (const row of report.entries || []) {
        lines.push(`| ${row.plugin_id} | ${row.entry_id} | ${row.level} | ${row.rule} | ${row.authorized ? 'yes' : 'no'} | ${row.tool_name || ''} | ${String(row.reason || '').replace(/\|/g, '/')} |`);
    }
    if (report.notes && report.notes.length) {
        lines.push('');
        lines.push('## 备注');
        lines.push('');
        for (const note of report.notes) lines.push(`- ${note}`);
    }
    lines.push('');
    return lines.join('\n');
}

function buildSummary(report) {
    const counts = report.level_counts || {};
    const packs = Array.isArray(report.enabled_packs) && report.enabled_packs.length
        ? report.enabled_packs.join(',')
        : '无';
    return [
        `状态 ${report.hub_state}`,
        `发现 ${report.plugin_count} 插件 / ${report.entry_count} 条目`,
        `C2 ${counts.C2 || 0} 条`,
        `已授权 ${report.approved_count} 条`,
        `已注册工具 ${report.registered_count} 个`,
        `回读确认 ${report.confirmed_count} 个`,
        `已勾选套装: ${packs}`,
        `端口 ${report.port || '未启动'}`,
        `报告 .runtime/report/compatibility.md`
    ].join('；');
}

function writeReport(runtimeDir, report) {
    const dir = path.join(runtimeDir, 'report');
    fs.mkdirSync(dir, { recursive: true });
    const jsonPath = path.join(dir, 'compatibility.json');
    const mdPath = path.join(dir, 'compatibility.md');
    fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    fs.writeFileSync(mdPath, buildMarkdown(report), 'utf8');
    return {
        jsonPath,
        mdPath,
        summary: buildSummary(report)
    };
}

module.exports = { writeReport, buildMarkdown, buildSummary, countByLevel };
