import { TFile } from 'obsidian'

export const isFile = (path) => app.vault.getAbstractFileByPath(path) instanceof TFile