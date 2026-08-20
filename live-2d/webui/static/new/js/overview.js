/* ============================================================
   My Neuro WebUI — 总览区与日志图表(overview.js)
   独立模块:不依赖、不修改 app.js;轮询 /api/overview 与
   /api/system/metrics,渲染总览横幅/管道/动态/插件与三块图表。
   只在服务控制页可见时轮询;颜色读 CSS 变量,随主题切换刷新。
   ============================================================ */
(function () {
    var POLL_MS = 2000;
    var timer = null;
    var charts = { llm: null, errors: null, resources: null };

    function isDashboardActive() {
        var d = document.getElementById('dashboard');
        return d && d.classList.contains('active');
    }

    function cssVar(name, fallback) {
        var v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
        return v || fallback;
    }

    function themeColors() {
        return {
            accent: cssVar('--accent', '#e75480'),
            accentLight: cssVar('--accent-light', '#ff9eb8'),
            accent2: cssVar('--accent-2', '#a78bfa'),
            green: cssVar('--green', '#2ba471'),
            red: cssVar('--red', '#e5484d'),
            blue: cssVar('--blue', '#4a86e8'),
            orange: cssVar('--orange', '#ef8b3a'),
            textSecondary: cssVar('--text-secondary', 'rgba(77,50,61,.72)'),
            border: cssVar('--border', 'rgba(231,84,128,.22)')
        };
    }

    // ---------- 总览区 ----------

    function fmtAgo(ts) {
        var diff = Date.now() - ts;
        if (diff < 5000) return '刚刚';
        if (diff < 60000) return Math.floor(diff / 1000) + ' 秒前';
        if (diff < 3600000) return Math.floor(diff / 60000) + ' 分钟前';
        return Math.floor(diff / 3600000) + ' 小时前';
    }

    function pad2(n) { return (n < 10 ? '0' : '') + n; }

    function renderBanner(data) {
        var live2dRunning = data.services && data.services.live2d === 'running';
        var dot = document.getElementById('overview-status-dot');
        var text = document.getElementById('overview-banner-text');
        var metricsEl = document.getElementById('overview-banner-metrics');
        if (dot) dot.className = 'overview-status-dot ' + (live2dRunning ? 'running' : 'idle');
        if (text) {
            var next = live2dRunning ? '桌宠运行中' : '控制中心空闲';
            if (text.textContent !== next) {
                text.textContent = next;
                text.classList.remove('banner-text-swap');
                void text.offsetWidth;
                text.classList.add('banner-text-swap');
            }
        }
        if (metricsEl) {
            var m = data.metrics || {};
            var src = m.live2d || m.webui;
            var label = m.live2d ? '桌宠' : (m.available ? '控制中心' : null);
            if (!m.available || !src) {
                metricsEl.textContent = '采样不可用';
            } else {
                var cpu = src.cpu_percent != null ? src.cpu_percent + '%' : '—';
                var rss = src.rss_mb != null ? Math.round(src.rss_mb) + ' MB' : '—';
                var uptime = '';
                if (typeof data.uptime_seconds === 'number') {
                    var h = Math.floor(data.uptime_seconds / 3600);
                    var min = Math.floor((data.uptime_seconds % 3600) / 60);
                    uptime = ' · 已运行 ' + (h > 0 ? h + ' 小时 ' : '') + min + ' 分钟';
                }
                metricsEl.textContent = (m.live2d ? '' : '(桌宠未启动,显示控制中心占用) ') +
                    label + ' · CPU ' + cpu + ' · 内存 ' + rss + uptime;
            }
        }
    }

    function setStat(id, val) {
        var el = document.getElementById(id);
        if (!el) return;
        if (el.textContent !== String(val)) {
            el.textContent = val;
            el.classList.remove('stat-bump');
            void el.offsetWidth;
            el.classList.add('stat-bump');
        }
    }

    function renderStats(data) {
        var m = data.metrics || {};
        var src = m.live2d || m.webui || {};
        setStat('stat-cpu', (m.available && src.cpu_percent != null) ? src.cpu_percent : '—');
        setStat('stat-rss', (m.available && src.rss_mb != null) ? Math.round(src.rss_mb) : '—');
        if (data.services) {
            var run = Object.keys(data.services).filter(function (k) { return data.services[k] === 'running'; }).length;
            setStat('stat-services', run + ' / ' + Object.keys(data.services).length);
        }
        if (data.plugins) setStat('stat-plugins', data.plugins.enabled_count + ' / ' + data.plugins.total);
    }

    function renderPipeline(stage) {
        var nodes = document.querySelectorAll('#overview-pipeline .pipeline-node');
        var idx = -1;
        nodes.forEach(function (el, i) {
            var on = el.getAttribute('data-stage') === stage;
            el.classList.toggle('active', on);
            if (on) idx = i;
        });
        // 当前节点之前的连线点亮
        document.querySelectorAll('#overview-pipeline .pipeline-link').forEach(function (link, i) {
            link.classList.toggle('lit', idx > 0 && i < idx);
        });
    }

    var LEVEL_CLASS = { info: 'dot-info', warn: 'dot-warn', error: 'dot-error' };
    var CAT_ICON = { dialogue: '💬', tool: '🔧', module: '⚙️', config: '🛠️', system: '📡' };
    // 播放类心跳事件不进动态区(太吵),原文仍在下方日志
    var SKIP_TYPES = { 'tts.start': 1, 'tts.end': 1, 'tts.interrupted': 1, 'asr.text': 1 };
    var lastEventTs = 0;
    function renderEvents(events) {
        var box = document.getElementById('overview-events');
        if (!box) return;
        var filtered = (events || []).filter(function (ev) { return !SKIP_TYPES[ev.type]; });
        if (filtered.length === 0) {
            box.innerHTML = '<div class="overview-empty">启动桌宠并说一句话后,这里会实时滚动重要动态</div>';
            lastEventTs = 0;
            return;
        }
        var newest = filtered[0].ts;
        box.innerHTML = filtered.map(function (ev) {
            var dotCls = LEVEL_CLASS[ev.level] || 'dot-info';
            var icon = CAT_ICON[ev.cat] || '•';
            var isNew = ev.ts > lastEventTs ? ' overview-event-new' : '';
            return '<div class="overview-event' + isNew + '" title="完整原文在下方日志">' +
                '<span class="overview-event-icon">' + icon + '</span>' +
                '<span class="overview-event-dot ' + dotCls + '"></span>' +
                '<span class="overview-event-title">' + escapeHtml(ev.title || '') + '</span>' +
                '<span class="overview-event-time">' + fmtAgo(ev.ts) + '</span>' +
                '</div>';
        }).join('');
        lastEventTs = newest;
    }

    // 插件速览:全部/已启用/未启用筛选,点击不重渲染(无闪烁),选择持久化
    var pluginFilter = 'all';
    try { pluginFilter = localStorage.getItem('overview-plugin-filter') || 'all'; } catch (e) { /* ignore */ }
    function renderPlugins(plugins) {
        var box = document.getElementById('overview-plugins');
        if (!box) return;
        var all = (plugins && plugins.all_plugins) || [];
        var list = all.filter(function (p) {
            if (pluginFilter === 'enabled') return p.enabled;
            if (pluginFilter === 'disabled') return !p.enabled;
            return true;
        });
        if (list.length === 0) {
            box.innerHTML = '<div class="overview-empty">暂无插件</div>';
            return;
        }
        box.innerHTML = list.map(function (p) {
            return '<span class="overview-plugin-chip ' + (p.enabled ? 'enabled' : 'disabled') + '">' +
                '<span class="chip-dot"></span>' + escapeHtml(p.name) + '</span>';
        }).join('');
    }

    function bindPluginFilter() {
        var wrap = document.getElementById('plugin-filter');
        if (!wrap) return;
        // 初始按钮态与持久化的筛选一致
        wrap.querySelectorAll('.plugin-filter-btn').forEach(function (b) {
            b.classList.toggle('active', b.getAttribute('data-filter') === pluginFilter);
        });
        wrap.addEventListener('click', function (e) {
            var btn = e.target.closest('.plugin-filter-btn');
            if (!btn) return;
            pluginFilter = btn.getAttribute('data-filter');
            try { localStorage.setItem('overview-plugin-filter', pluginFilter); } catch (e) { /* ignore */ }
            wrap.querySelectorAll('.plugin-filter-btn').forEach(function (b) {
                b.classList.toggle('active', b === btn);
            });
            if (lastData) renderPlugins(lastData.plugins);
        });
    }

    function escapeHtml(s) {
        return String(s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    // ---------- 图表区 ----------

    function baseChartOpts(c) {
        return {
            responsive: true,
            maintainAspectRatio: false,
            animation: { duration: 400 },
            // 无合成帧的环境(未聚焦的隐藏 tab/无头)下 Chart 的 resize 探测会
            // 把宽度压到 0;这里回退到 offsetWidth 测量,有帧时行为不变。
            onResize: function (chart, size) {
                if (!size || size.width > 0) return;
                var w = chart.canvas.parentElement ? chart.canvas.parentElement.offsetWidth : 0;
                var h = chart.canvas.parentElement ? chart.canvas.parentElement.offsetHeight : 0;
                if (w > 0 && h > 0) chart.resize(w, h);
            },
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { labels: { color: c.textSecondary, boxWidth: 12, font: { size: 11 } } },
                tooltip: { enabled: true }
            },
            scales: {
                x: {
                    ticks: { color: c.textSecondary, maxTicksLimit: 6, font: { size: 10 } },
                    grid: { color: c.border, drawBorder: false }
                },
                y: {
                    beginAtZero: true,
                    ticks: { color: c.textSecondary, font: { size: 10 } },
                    grid: { color: c.border, drawBorder: false }
                }
            }
        };
    }

    function ensureChart(key, canvasId, config) {
        if (typeof Chart === 'undefined') return null;
        if (charts[key]) return charts[key];
        var el = document.getElementById(canvasId);
        if (!el) return null;
        charts[key] = new Chart(el.getContext('2d'), config);
        return charts[key];
    }

    function setEmpty(chartKey, emptyId, hasData) {
        var el = document.getElementById(emptyId);
        var canvas = document.querySelector('#' + emptyId.replace('-empty', ''));
        if (el) el.style.display = hasData ? 'none' : 'flex';
        if (canvas) canvas.style.visibility = hasData ? 'visible' : 'hidden';
    }

    function renderLLMChart(llmRuns, c) {
        var has = llmRuns && llmRuns.length > 0;
        setEmpty('llm', 'chart-llm-empty', has);
        if (!has) return;
        var labels = llmRuns.map(function (r) { return new Date(r.ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }); });
        var durations = llmRuns.map(function (r) { return r.duration_ms != null ? +(r.duration_ms / 1000).toFixed(2) : null; });
        var tokens = llmRuns.map(function (r) { return r.output_tokens != null ? r.output_tokens : null; });
        var chart = ensureChart('llm', 'chart-llm', {
            type: 'line',
            data: { labels: [], datasets: [
                { label: '耗时 (s)', data: [], borderColor: c.accent, backgroundColor: c.accent, tension: 0.3, pointRadius: 2, yAxisID: 'y' },
                { label: '输出 tokens', data: [], borderColor: c.accent2, backgroundColor: c.accent2, tension: 0.3, pointRadius: 2, borderDash: [4, 3], yAxisID: 'y1' }
            ]},
            options: Object.assign(baseChartOpts(c), {
                scales: {
                    x: baseChartOpts(c).scales.x,
                    y: Object.assign(baseChartOpts(c).scales.y, { title: { display: true, text: '秒', color: c.textSecondary, font: { size: 10 } } }),
                    y1: { position: 'right', beginAtZero: true, grid: { drawOnChartArea: false }, ticks: { color: c.accent2, font: { size: 10 } }, title: { display: true, text: 'tokens', color: c.accent2, font: { size: 10 } } }
                }
            })
        });
        if (!chart) return;
        chart.data.labels = labels;
        chart.data.datasets[0].data = durations;
        chart.data.datasets[1].data = tokens;
        chart.data.datasets[0].borderColor = c.accent;
        chart.data.datasets[1].borderColor = c.accent2;
        chart.update('none');
    }

    function renderErrorsChart(errorSeries, c) {
        var has = errorSeries && errorSeries.length > 0;
        setEmpty('errors', 'chart-errors-empty', has);
        if (!has) return;
        var labels = errorSeries.map(function (b) { return new Date(b.ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }); });
        var chart = ensureChart('errors', 'chart-errors', {
            type: 'bar',
            data: { labels: [], datasets: [
                { label: '错误', data: [], backgroundColor: c.red, stack: 's' },
                { label: '警告', data: [], backgroundColor: c.orange, stack: 's' }
            ]},
            options: Object.assign(baseChartOpts(c), { scales: {
                x: Object.assign(baseChartOpts(c).scales.x, { stacked: true }),
                y: Object.assign(baseChartOpts(c).scales.y, { stacked: true, ticks: { stepSize: 1, color: c.textSecondary, font: { size: 10 } } })
            }})
        });
        if (!chart) return;
        chart.data.labels = labels;
        chart.data.datasets[0].data = errorSeries.map(function (b) { return b.error; });
        chart.data.datasets[1].data = errorSeries.map(function (b) { return b.warn; });
        chart.data.datasets[0].backgroundColor = c.red;
        chart.data.datasets[1].backgroundColor = c.orange;
        chart.update('none');
    }

    function renderResourcesChart(series, c) {
        var has = series && series.length > 0;
        setEmpty('resources', 'chart-resources-empty', has);
        if (!has) return;
        var labels = series.map(function (p) { return new Date(p.ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }); });
        // 优先桌宠进程,未启动则 WebUI 自身
        var src = series.map(function (p) { return p.live2d || p.webui || {}; });
        var cpu = src.map(function (s) { return s.cpu_percent != null ? s.cpu_percent : null; });
        var rss = src.map(function (s) { return s.rss_mb != null ? s.rss_mb : null; });
        var chart = ensureChart('resources', 'chart-resources', {
            type: 'line',
            data: { labels: [], datasets: [
                { label: 'CPU %', data: [], borderColor: c.green, backgroundColor: c.green, tension: 0.3, pointRadius: 0, yAxisID: 'y' },
                { label: '内存 MB', data: [], borderColor: c.blue, backgroundColor: c.blue, tension: 0.3, pointRadius: 0, yAxisID: 'y1' }
            ]},
            options: Object.assign(baseChartOpts(c), {
                scales: {
                    x: baseChartOpts(c).scales.x,
                    y: Object.assign(baseChartOpts(c).scales.y, { max: 100, title: { display: true, text: '%', color: c.textSecondary, font: { size: 10 } } }),
                    y1: { position: 'right', beginAtZero: true, grid: { drawOnChartArea: false }, ticks: { color: c.blue, font: { size: 10 } }, title: { display: true, text: 'MB', color: c.blue, font: { size: 10 } } }
                }
            })
        });
        if (!chart) return;
        chart.data.labels = labels;
        chart.data.datasets[0].data = cpu;
        chart.data.datasets[1].data = rss;
        chart.data.datasets[0].borderColor = c.green;
        chart.data.datasets[1].borderColor = c.blue;
        chart.update('none');
    }

    // ---------- 轮询 ----------

    var lastData = null;
    function tick() {
        if (!isDashboardActive()) return;
        var c = themeColors();
        fetch('/api/overview').then(function (r) { return r.json(); }).then(function (data) {
            if (!data || !data.ok) return;
            lastData = data;
            renderBanner(data);
            renderStats(data);
            renderPipeline(data.pipeline_stage);
            renderEvents(data.recent_events);
            renderPlugins(data.plugins);
            renderLLMChart(data.llm_runs, c);
            renderErrorsChart(data.error_series, c);
        }).catch(function () { /* 网络错误静默,下轮再试 */ });

        fetch('/api/system/metrics').then(function (r) { return r.json(); }).then(function (data) {
            if (!data || !data.ok) return;
            renderResourcesChart(data.series, themeColors());
        }).catch(function () { /* 静默 */ });
    }

    function start() {
        if (timer) return;
        tick();
        timer = setInterval(tick, POLL_MS);
    }

    // 主题切换后刷新图表配色
    function watchTheme() {
        new MutationObserver(function () {
            if (charts.llm || charts.errors || charts.resources) tick();
        }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    }

    document.addEventListener('DOMContentLoaded', function () {
        if (!document.getElementById('overview-board')) return;
        bindPluginFilter();
        start();
        watchTheme();
    });
})();
