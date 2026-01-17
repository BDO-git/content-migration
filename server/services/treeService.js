const fs = require('fs');
const path = require('path');
const sax = require('sax');

class TreeService {
    constructor() { }

    async buildTree(rootDir) {
        const rootNode = {
            path: '/',
            name: 'jcr_root',
            primaryType: 'nt:folder', // Default
            properties: {},
            children: []
        };

        await this.traverse(rootDir, rootNode, '/');
        return rootNode;
    }

    async traverse(currentPath, parentNode, jcrPath) {
        const entries = await fs.promises.readdir(currentPath, { withFileTypes: true });

        // First check for .content.xml in current directory to populate parentNode properties
        const contentXml = entries.find(e => e.name === '.content.xml');
        if (contentXml) {
            const xmlPath = path.join(currentPath, '.content.xml');
            const nodeData = await this.parseContentXml(xmlPath);
            // Merge properties found in .content.xml into the directory node representing it
            Object.assign(parentNode.properties, nodeData.properties);
            parentNode.primaryType = nodeData.primaryType || parentNode.primaryType;
        }

        for (const entry of entries) {
            if (entry.isDirectory()) {
                // Ignore META-INF and other non-content dirs if strictly content
                if (entry.name === 'META-INF') continue;

                const nodeName = entry.name;
                const nodePath = jcrPath === '/' ? `/${nodeName}` : `${jcrPath}/${nodeName}`;

                // Create a basic folder node, will be enriched if .content.xml exists inside it
                const childNode = {
                    path: nodePath,
                    name: nodeName,
                    primaryType: 'nt:folder',
                    properties: {},
                    children: []
                };

                parentNode.children.push(childNode);
                await this.traverse(path.join(currentPath, nodeName), childNode, nodePath);
            } else if (entry.name === '.content.xml') {
                // Already handled above
                continue;
            } else {
                // Binary files or other files
                // For migration, we might need to handle binaries. 
                // AEM File Vault usually stores binaries as files or in .content.xml.
                // For now, logging presence.
            }
        }

        // Handle serialization of nodes defined ENTIRELY within .content.xml (children of jcr:root in xml)
        // If the .content.xml has child nodes defined inline, they need to be added to parentNode.children
        if (contentXml) {
            const xmlPath = path.join(currentPath, '.content.xml');
            // We need a parser that returns structure including children.
            // The previous parseContentXml only returned top properties.
            // Adjusting strategy: parseContentXml should return full structure of the XML file.
            const deepNodeData = await this.parseContentXmlDeep(xmlPath);

            // The root of .content.xml corresponds to the directory itself (parentNode)
            // But it might have children defined inline.
            if (deepNodeData.children && deepNodeData.children.length > 0) {
                // Map inline children to tree nodes
                deepNodeData.children.forEach(inlineChild => {
                    inlineChild.path = jcrPath === '/' ? `/${inlineChild.name}` : `${jcrPath}/${inlineChild.name}`;
                    parentNode.children.push(inlineChild);
                });
            }
        }
    }

    // Simplified parser for properties + children
    parseContentXmlDeep(xmlPath) {
        return new Promise((resolve, reject) => {
            const stream = fs.createReadStream(xmlPath, { encoding: 'utf8' });
            const parser = sax.createStream(true);

            let rootNode = null;
            const stack = [];

            parser.on('opentag', (node) => {
                const newNode = {
                    name: node.name, // Temporary, usually mapped from node name in XML structure
                    primaryType: node.attributes['jcr:primaryType'] || 'nt:unstructured',
                    properties: { ...node.attributes },
                    children: []
                };

                // Remove xmlns and other non-data attributes if needed, but keeping for fidelity

                if (!rootNode) {
                    rootNode = newNode;
                    stack.push(rootNode);
                } else {
                    const parent = stack[stack.length - 1];
                    // The name in XML is the node name
                    newNode.name = node.name;
                    parent.children.push(newNode);
                    stack.push(newNode);
                }
            });

            parser.on('closetag', () => {
                stack.pop();
            });

            parser.on('error', (e) => reject(e));
            parser.on('end', () => resolve(rootNode));

            stream.pipe(parser);
        });
    }

    // Shallow parser kept for compatibility if needed, but deep is better
    async parseContentXml(xmlPath) {
        return this.parseContentXmlDeep(xmlPath);
    }
}

module.exports = TreeService;
