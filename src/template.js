export const createFileFromTemplate = async(app, templatePath, filePath) => {
    const templateFile = app.vault.getAbstractFileByPath(templatePath)
    const templateContent = await app.vault.cachedRead(templateFile)

    const templatesPlugin = app.internalPlugins.plugins.templates;

    if (!templatesPlugin.enabled) { 
        await app.vault.createBinary(filePath, templateContent)
        return
    }
    
    const newFile = await app.vault.createBinary(filePath, "")
    const newLeaf = app.workspace.getLeaf('tab');
    await newLeaf.openFile(newFile, {active: false});
    app.workspace.setActiveLeaf(newLeaf, false, false);
    await templatesPlugin.instance.insertTemplate(templateFile)
    newLeaf.detach()
}