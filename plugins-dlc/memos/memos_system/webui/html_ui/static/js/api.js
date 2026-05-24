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

    async getGraphStats() {
        try {
            const response = await fetch(`${API_BASE_URL}/graph/stats`);
            return response.ok ? await response.json() : null;
        } catch (e) {
            return null;
        }
    },

    async getMemories(limit = 500) {
        try {
            const response = await fetch(`${API_BASE_URL}/list?limit=${limit}`);
            return response.ok ? await response.json() : null;
        } catch (e) {
            return null;
        }
    },

    async deleteMemory(id) {
        try {
            const response = await fetch(`${API_BASE_URL}/delete/${id}`, { method: 'DELETE' });
            return response.ok;
        } catch (e) {
            return false;
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

    async searchMemories(query, topK, useGraph, threshold) {
        try {
            const response = await fetch(`${API_BASE_URL}/search`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    query: query,
                    top_k: topK,
                    use_graph: useGraph,
                    similarity_threshold: threshold
                })
            });
            return response.ok ? await response.json() : null;
        } catch (e) {
            return null;
        }
    },

    async addMemory(content, importance) {
        try {
            const response = await fetch(`${API_BASE_URL}/memory/raw`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    messages: [
                        { content: content, role: 'user', importance: importance }
                    ]
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
                type: e.type,
                title: `类型: ${e.type || '未知'}\n${e.properties?.description || ''}`
            }));
            
            const edges = (relationsData.relations || []).map(r => ({
                source: r.source_id,
                target: r.target_id,
                label: r.type,
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

    async importDocument(source, extractEntities = false) {
        try {
            const response = await fetch(`${API_BASE_URL}/kb/import`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    source: source,
                    extract_entities: extractEntities
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
    }
};