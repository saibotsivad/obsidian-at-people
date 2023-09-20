import { EditorSuggest, normalizePath, Plugin, PluginSettingTab, Setting } from 'obsidian'
import { FileSuggester, FolderSuggester } from './suggesters'

const DEFAULT_SETTINGS = {
	peopleFolder: 'People',
	createFileOnNewPerson: true,
	// Defaults:
	// useExplicitLinks: undefined,
	// useLastNameFolder: undefined,
	// templateFile: undefined
}

const NAME_REGEX = /\/@([^\/]+)\.md$/
const LAST_NAME_REGEX = /([\S]+)$/

const getPersonName = (filename, settings) => filename.startsWith(settings.peopleFolder)
	&& filename.endsWith('.md')
	&& filename.includes('/@')
	&& NAME_REGEX.exec(filename)?.[1]

const getTemplateContent = async (vault, templateFilePath) => {
	if (!templateFilePath) { return "" }
	const templateFile = vault.getAbstractFileByPath(templateFilePath)
	return vault.cachedRead(templateFile)
}

const createFile = async (vault, filePath, content) => {
	return vault.createBinary(filePath, content)
}

const createPersonFile = async (vault, filePath, templateFilePath) => {
	const content = await getTemplateContent(vault, templateFilePath)
	return createFile(vault, filePath, content)
}

module.exports = class AtPeople extends Plugin {
	async onload() {
		await this.loadSettings()
		this.registerEvent(this.app.vault.on('delete', async event => { await this.update(event) }))
		this.registerEvent(this.app.vault.on('create', async event => { await this.update(event) }))
		this.registerEvent(this.app.vault.on('rename', async (event, originalFilepath) => { await this.update(event, originalFilepath) }))
		this.addSettingTab(new AtPeopleSettingTab(this.app, this))
		this.suggestor = new AtPeopleSuggestor(this.app, this.settings)
		this.registerEditorSuggest(this.suggestor)
		this.app.workspace.onLayoutReady(this.initialize)
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData())
	}

	async saveSettings() {
		await this.saveData(this.settings || DEFAULT_SETTINGS)
	}

	updatePeopleMap = () => {
		this.suggestor.updatePeopleMap(this.peopleFileMap)
	}

	update = async ({ path, deleted, ...remaining }, originalFilepath) => {
		this.peopleFileMap = this.peopleFileMap || {}
		const name = getPersonName(path, this.settings)
		let needsUpdated
		if (name) {
			this.peopleFileMap[name] = path
			needsUpdated = true
		}
		originalFilepath = originalFilepath && getPersonName(originalFilepath, this.settings)
		if (originalFilepath) {
			delete this.peopleFileMap[originalFilepath]
			needsUpdated = true
		}
		if (needsUpdated) this.updatePeopleMap()
	}

	initialize = () => {
		this.peopleFileMap = {}
		for (const filename in this.app.vault.fileMap) {
			const name = getPersonName(filename, this.settings)
			if (name) this.peopleFileMap[name] = filename
		}
		window.setTimeout(() => {
			this.updatePeopleMap()
		})
	}
}

class AtPeopleSuggestor extends EditorSuggest {
	constructor(app, settings) {
		super(app)
		this.settings = settings
	}
	updatePeopleMap(peopleFileMap) {
		this.peopleFileMap = peopleFileMap
	}
	onTrigger(cursor, editor, tFile) {
		let charsLeftOfCursor = editor.getLine(cursor.line).substring(0, cursor.ch)
		let atIndex = charsLeftOfCursor.lastIndexOf('@')
		let query = atIndex >= 0 && charsLeftOfCursor.substring(atIndex + 1)
		if (
			query
			&& !query.includes(']]')
			&& (
				// if it's an @ at the start of a line
				atIndex === 0
				// or if there's a space character before it
				|| charsLeftOfCursor[atIndex - 1] === ' '
			)
		) {
			return {
				start: { line: cursor.line, ch: atIndex },
				end: { line: cursor.line, ch: cursor.ch },
				query,
			}
		}
		return null
	}
	getSuggestions(context) {
		let suggestions = []
		for (let key in (this.peopleFileMap || {}))
			if (key.toLowerCase().startsWith(context.query))
				suggestions.push({
					suggestionType: 'set',
					displayText: key,
					context,
				})
		suggestions.push({
			suggestionType: 'create',
			displayText: context.query,
			context,
		})
		return suggestions
	}
	renderSuggestion(value, elem) {
		if (value.suggestionType === 'create') elem.setText('New person: ' + value.displayText)
		else elem.setText(value.displayText)
	}
	selectSuggestion(value) {
		let link
		if (this.settings.useExplicitLinks && this.settings.useLastNameFolder) {
			let lastName = LAST_NAME_REGEX.exec(value.displayText)
			lastName = lastName && lastName[1] && (lastName[1] + '/') || ''
			link = `[[${this.settings.peopleFolder}${lastName}@${value.displayText}.md|@${value.displayText}]]`
		} else if (this.settings.useExplicitLinks && !this.settings.useLastNameFolder) {
			link = `[[${this.settings.peopleFolder}@${value.displayText}.md|@${value.displayText}]]`
		} else {
			link = `[[@${value.displayText}]]`
		}

		if (value.suggestionType === 'create' && this.settings.createFileOnNewPerson) {
			const personFilePath = normalizePath(`${this.settings.peopleFolder}/@${value.displayText}.md`)
			const templateFilePath = normalizePath(this.settings.templateFile)
			createPersonFile(this.app.vault, personFilePath, templateFilePath)
		}

		value.context.editor.replaceRange(
			link,
			value.context.start,
			value.context.end,
		)
	}
}

class AtPeopleSettingTab extends PluginSettingTab {
	constructor(app, plugin) {
		super(app, plugin)
		this.plugin = plugin
	}
	display() {
		const { containerEl } = this
		containerEl.empty()
		new Setting(containerEl)
			.setName('People folder')
			.setDesc('The folder where people files live')
			.addSearch((search) => {
				new FolderSuggester(this.app, search.inputEl);
                search
                    .setValue(this.plugin.settings.peopleFolder)
                    .onChange((newFolder) => {
                        this.plugin.settings.peopleFolder = normalizePath(newFolder);
                        this.plugin.saveSettings();
                    });
			})
		new Setting(containerEl)
			.setName('Explicit links')
			.setDesc('When inserting links include the full path, e.g. [[People/@Bob Dole.md|@Bob Dole]]')
			.addToggle(
				toggle => toggle.onChange(async (value) => {
					this.plugin.settings.useExplicitLinks = value
					await this.plugin.saveSettings()
				})
			)
		new Setting(containerEl)
			.setName('Last name folder')
			.setDesc('When using explicit links, use the "last name" (the last non-spaced word) as a sub-folder, e.g. [[People/Dole/@Bob Dole.md|@Bob Dole]]')
			.addToggle(
				toggle => toggle.onChange(async (value) => {
					this.plugin.settings.useLastNameFolder = value
					await this.plugin.saveSettings()
				})
			)
		new Setting(containerEl)
			.setName('Create file when adding new person')
			.setDesc('When adding a new person, create the corresponding file in the People folder')
			.addToggle(toggle => {
				toggle
					.setValue(this.plugin.settings.createFileOnNewPerson)
					.onChange((value) => {
						this.plugin.settings.createFileOnNewPerson = value
						this.plugin.saveSettings()
					})
			})
		new Setting(containerEl)
			.setName('Template file location')
			.setDesc('This file will be used as a template for the new person file')
			.addSearch((search) => {
				new FileSuggester(this.app, search.inputEl);
                search.setPlaceholder("Ex.: ./Templates")
					.setValue(this.plugin.settings.templateFile)
					.onChange((newFile) => {
						this.plugin.settings.templateFile = normalizePath(newFile);
						this.plugin.saveSettings();
					});
			})
	}
}
