class TransformService {
    constructor() { }

    transformTree(rootNode, config) {
        // config includes: templateMappings, componentMappings, sourceRoot, targetRoot
        this.traverseAndTransform(rootNode, config);
        return rootNode;
    }

    traverseAndTransform(node, config) {
        // 1. Transform Path (Re-rooting)
        if (node.path && config.sourceRoot && config.targetRoot) {
            // Simple replace of prefix if it matches
            if (node.path.startsWith(config.sourceRoot)) {
                node.path = node.path.replace(config.sourceRoot, config.targetRoot);
            }
        }

        // 2. Transform Templates (cq:Page)
        if (node.primaryType === 'cq:Page' || (node.properties && node.properties['jcr:primaryType'] === 'cq:Page')) {
            // Usually template is on jcr:content node, not the page node itself
            // So we look for the child 'jcr:content'
            const contentNode = node.children && node.children.find(c => c.name === 'jcr:content');
            if (contentNode) {
                this.applyTemplateMapping(contentNode, config.templateMappings);
            }
        }

        // 3. Transform Components
        // Check sling:resourceType
        if (node.properties && node.properties['sling:resourceType']) {
            this.applyComponentMapping(node, config.componentMappings);
        }

        // Recursion
        if (node.children) {
            node.children.forEach(child => this.traverseAndTransform(child, config));
        }
    }

    applyTemplateMapping(contentNode, templateMappings) {
        if (!templateMappings) return;

        const currentTemplate = contentNode.properties['cq:template'];
        if (!currentTemplate) return;

        const mapping = templateMappings.find(m => m.sourceTemplate === currentTemplate);
        if (mapping) {
            // Update Template
            contentNode.properties['cq:template'] = mapping.targetTemplate;

            // Map Properties
            if (mapping.propertyMappings) {
                for (const [sourceProps, targetProp] of Object.entries(mapping.propertyMappings)) {
                    // Handle nested properties if needed. For now simple key mapping.
                    // If source has nested logic, we need to locate it.
                    const value = contentNode.properties[sourceProps];
                    if (value !== undefined) {
                        contentNode.properties[targetProp] = value;
                        // Remove legacy? 
                        // contentNode.properties[sourceProps] = undefined; // Optional based on config
                    }
                }
            }
        }
    }

    applyComponentMapping(node, componentMappings) {
        if (!componentMappings) return;

        const currentResType = node.properties['sling:resourceType'];
        const mapping = componentMappings.find(m => m.sourceComponent === currentResType);

        if (mapping) {
            // Update Resource Type
            node.properties['sling:resourceType'] = mapping.targetComponent;

            // Map Properties
            if (mapping.propertyMappings) {
                for (const [sourceProps, targetProp] of Object.entries(mapping.propertyMappings)) {
                    const value = node.properties[sourceProps];
                    if (value !== undefined) {
                        node.properties[targetProp] = value;
                    }
                }
            }
        }
    }
}

module.exports = TransformService;
