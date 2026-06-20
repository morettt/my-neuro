const API_BASE_URL = 'http://127.0.0.1:8003';

const API = {
    async checkHealth() {
        try {
            const response = await fetch(`${API_BASE_URL}/health`, { timeout: 2000 });
            if (!response.ok) return { status: false, data: {} };
            const data = await response.json();
            return { status: true, data };
        } catch (e) {
            return { status: false, data: {} };
        }
    },

    async getStats() {
        try {
            const response = await fetch(`${API_BASE_URL}/stats`);
            return response.ok ? await response.json() : null;
        } catch (e) {
            return null;
        }
    },

    async getEvolutionStatus() {
        try {
            const response = await fetch(`${API_BASE_URL}/memory/evolution/status`);
            return response.ok ? await response.json() : null;
        } catch (e) {
            return null;
        }
    },

    async getGraphStats() {
        try {
            const response = await fetch(`${API_BASE_URL}/graph/stats`);
            return response.ok ? await response.json() : null;
        } catch (e) {
            return null;
        }
    },

    async getMemories(options = {}) {
        try {
            const params = new URLSearchParams();
            params.set('limit', String(options.limit ?? 0));
            if (options.status) params.set('status', options.status);
            if (options.layer) params.set('layer', options.layer);
            if (options.include_deleted) params.set('include_deleted', String(!!options.include_deleted));
            const response = await fetch(`${API_BASE_URL}/list?${params.toString()}`);
            return response.ok ? await response.json() : null;
        } catch (e) {
            return null;
        }
    },

    async deleteMemory(id, hard = false) {
        try {
            const response = await fetch(`${API_BASE_URL}/delete/${id}?hard=${hard}`, { method: 'DELETE' });
            return response.ok;
        } catch (e) {
            return false;
        }
    },

    async recoverMemory(memoryId, deleteRecordId) {
        try {
            const response = await fetch(`${API_BASE_URL}/recover_memory`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    memory_id: memoryId || null,
                    delete_record_id: deleteRecordId || null
                })
            });
            return response.ok ? await response.json() : null;
        } catch (e) {
            return null;
        }
    },

    async restoreMemory(id) {
        try {
            const response = await fetch(`${API_BASE_URL}/memory/${encodeURIComponent(id)}/restore`, {
                method: 'POST'
            });
            return response.ok ? await response.json() : null;
        } catch (e) {
            return null;
        }
    },

    async archiveMemory(id, reason = '') {
        try {
            const response = await fetch(`${API_BASE_URL}/memory/feedback`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    memory_id: id,
                    feedback_type: 'archive',
                    reason
                })
            });
            return response.ok ? await response.json() : null;
        } catch (e) {
            return null;
        }
    },

    async editMemory(id, newContent) {
        try {
            const response = await fetch(`${API_BASE_URL}/memory/feedback`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    memory_id: id,
                    feedback_type: 'correct',
                    correction: newContent
                })
            });
            return response.ok;
        } catch (e) {
            return false;
        }
    },

    async searchMemories(query, topK, useGraph, threshold, options = {}) {
        try {
            const response = await fetch(`${API_BASE_URL}/search`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    query: query,
                    top_k: topK,
                    use_graph: useGraph,
                    use_bm25: options.use_bm25,
                    similarity_threshold: threshold,
                    memory_types: options.memory_types || null,
                    tags: options.tags || null,
                    layers: options.layers || null
                })
            });
            return response.ok ? await response.json() : null;
        } catch (e) {
            return null;
        }
    },

    async addMemory(content, importance, options = {}) {
        try {
            const response = await fetch(`${API_BASE_URL}/add_raw`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    messages: [
                        {
                            content: content,
                            role: 'user',
                            importance: importance,
                            memory_type: options.memory_type || 'general',
                            tags: options.tags || []
                        }
                    ],
                    extract_entities: !!options.extract_entities
                })
            });
            return response.ok;
        } catch (e) {
            return false;
        }
    },

    async getGraphData() {
        try {
            const [entitiesRes, relationsRes] = await Promise.all([
                fetch(`${API_BASE_URL}/graph/entities?limit=100`),
                fetch(`${API_BASE_URL}/graph/relations?limit=200`)
            ]);

            if (!entitiesRes.ok || !relationsRes.ok) {
                console.warn(`Graph API returned error`);
                return null;
            }

            const entitiesData = await entitiesRes.json();
            const relationsData = await relationsRes.json();

            // Format for vis-network
            const nodes = (entitiesData.entities || []).map(e => ({
                id: e.id,
                label: e.name,
                type: e.entity_type || e.type,
                title: `类型: ${e.entity_type || e.type || '未知'}\n${e.description || e.properties?.description || ''}`
            }));

            const edges = (relationsData.relations || []).map(r => ({
                source: r.source_id,
                target: r.target_id,
                label: r.relation_type || r.type,
                title: r.properties?.description || ''
            }));

            return { nodes, edges };
        } catch (e) {
            console.error("Failed to fetch graph data:", e);
            return null;
        }
    },

    async getImages(limit = 50) {
        try {
            const response = await fetch(`${API_BASE_URL}/images?limit=${limit}`);
            return response.ok ? await response.json() : null;
        } catch (e) {
            return null;
        }
    },

    async getImageData(imageId, thumbnail = true) {
        try {
            const response = await fetch(`${API_BASE_URL}/images/${imageId}/data?thumbnail=${thumbnail}`);
            if (!response.ok) return null;
            const result = await response.json();
            return result.data || null;
        } catch (e) {
            return null;
        }
    },

    async deleteImage(imageId) {
        try {
            const response = await fetch(`${API_BASE_URL}/images/${imageId}`, { method: 'DELETE' });
            return response.ok;
        } catch (e) {
            return false;
        }
    },

    async importDocument(source, extractEntities = false, options = {}) {
        try {
            const response = await fetch(`${API_BASE_URL}/kb/import`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    source: source,
                    extract_entities: extractEntities,
                    kb_id: options.kb_id || 'default',
                    title: options.title || null,
                    tags: options.tags || []
                })
            });
            return response.ok ? await response.json() : null;
        } catch (e) {
            return null;
        }
    },

    async deduplicateMemories(threshold) {
        try {
            const response = await fetch(`${API_BASE_URL}/deduplicate?threshold=${threshold}`, {
                method: 'POST'
            });
            return response.ok ? await response.json() : null;
        } catch (e) {
            return null;
        }
    },

    async getKnowledgeBases() {
        try {
            const response = await fetch(`${API_BASE_URL}/kb/list`);
            return response.ok ? await response.json() : null;
        } catch (e) {
            return null;
        }
    },

    async getKbDocs(kbId = '') {
        try {
            const query = kbId ? `?kb_id=${encodeURIComponent(kbId)}` : '';
            const response = await fetch(`${API_BASE_URL}/kb/docs${query}`);
            return response.ok ? await response.json() : null;
        } catch (e) {
            return null;
        }
    },

    async renameKnowledgeBase(oldKbId, newKbId) {
        try {
            const response = await fetch(`${API_BASE_URL}/kb/rename`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    old_kb_id: oldKbId,
                    new_kb_id: newKbId
                })
            });
            return response.ok ? await response.json() : null;
        } catch (e) {
            return null;
        }
    },

    async getKbDoc(docId) {
        try {
            const response = await fetch(`${API_BASE_URL}/kb/doc?doc_id=${encodeURIComponent(docId)}`);
            return response.ok ? await response.json() : null;
        } catch (e) {
            return null;
        }
    },

    async deleteKbDoc(docId, hard = false) {
        try {
            const response = await fetch(`${API_BASE_URL}/kb/delete?doc_id=${encodeURIComponent(docId)}&hard=${hard}`, { method: 'DELETE' });
            return response.ok ? await response.json() : null;
        } catch (e) {
            return null;
        }
    },

    async reindexKbDoc(docId) {
        try {
            const response = await fetch(`${API_BASE_URL}/kb/reindex?doc_id=${encodeURIComponent(docId)}`, { method: 'POST' });
            return response.ok ? await response.json() : null;
        } catch (e) {
            return null;
        }
    },

    async getToolStats() {
        try {
            const response = await fetch(`${API_BASE_URL}/tools/stats`);
            return response.ok ? await response.json() : null;
        } catch (e) {
            return null;
        }
    },

    async getFrequentlyUsedTools(category = '', topK = 10) {
        try {
            const params = new URLSearchParams({ top_k: String(topK) });
            if (category) params.set('category', category);
            const response = await fetch(`${API_BASE_URL}/tools/frequently-used?${params.toString()}`);
            return response.ok ? await response.json() : null;
        } catch (e) {
            return null;
        }
    },

    async getRecentToolUsage(toolName = '', limit = 20) {
        try {
            const params = new URLSearchParams({ limit: String(limit) });
            if (toolName) params.set('tool_name', toolName);
            const response = await fetch(`${API_BASE_URL}/tools/recent?${params.toString()}`);
            return response.ok ? await response.json() : null;
        } catch (e) {
            return null;
        }
    },

    async getToolSuggestions(toolName) {
        try {
            const response = await fetch(`${API_BASE_URL}/tools/suggest/${encodeURIComponent(toolName)}`);
            return response.ok ? await response.json() : null;
        } catch (e) {
            return null;
        }
    },

    async deleteToolRecord(recordId) {
        try {
            const response = await fetch(`${API_BASE_URL}/tools/${encodeURIComponent(recordId)}`, { method: 'DELETE' });
            return response.ok;
        } catch (e) {
            return false;
        }
    }
};
