import { EditorView } from "codemirror";
import { EditorState, Compartment } from "@codemirror/state";
import { keymap, highlightActiveLine } from "@codemirror/view";
import { defaultHighlightStyle, syntaxHighlighting, indentOnInput, bracketMatching, LanguageSupport } from "@codemirror/language";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { highlightSelectionMatches } from "@codemirror/search";
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { markdown } from "@codemirror/lang-markdown";
import { latexLanguage } from "codemirror-lang-latex";
import { solarizedDark } from 'cm6-theme-solarized-dark';

const { open, save } = window.__TAURI__.dialog;
const { readFile, readTextFile, remove, writeTextFile } = window.__TAURI__.fs;
const { openUrl } = window.__TAURI__.opener;
const { basename, dirname, resolve } = window.__TAURI__.path;
const { Command } = window.__TAURI__.shell;
const { LazyStore } = window.__TAURI__.store;

let store, editor;

const text = {
    preamble: ``,
    body: ``,
    extensions: ``
}

const defaults = {
    preamble: ``,
    body: ``,
    extensions: ``
}

let markdownPath = '';

let language = new Compartment;

async function initialize() {
    defaults.preamble = await store.get('preamble');
    defaults.body = await store.get('body');
    defaults.extensions = await store.get('extensions');
    document.querySelector('#default-preamble-text').value = defaults.preamble;
    document.querySelector('#default-body-text').value = defaults.body;
    document.querySelector('#default-extensions').value = defaults.extensions;
    Object.assign(text, defaults);
    editor.dispatch({
        changes: {
            from: 0,
            to: editor.state.doc.length,
            insert: document.querySelector('#preamble-button').classList.contains('secondary') ? text.body : text.preamble
        }
    });
    document.querySelector('#extensions').value = text.extensions;
}

function newButton() {
    document.querySelector('#menu').removeAttribute('open');
    markdownPath = '';
    Object.assign(text, defaults);
    editor.dispatch({
        changes: {
            from: 0,
            to: editor.state.doc.length,
            insert: document.querySelector('#preamble-button').classList.contains('secondary') ? defaults.body : defaults.preamble
        }
    });
    document.querySelector('#extensions').value = defaults.extensions;
    document.querySelector('#pdf').innerHTML = '';
}

async function saveButton() {
    if (markdownPath === '') {
        saveAsButton();
    } else {
        document.querySelector('#menu').removeAttribute('open');
        await writeTextFile(markdownPath, text.body);
    }
}

async function saveAsButton() {
    document.querySelector('#menu').removeAttribute('open');
    const path = await save({
        filters: [
            {
                name: 'Markdown',
                extensions: ['md']
            }
        ]
    });
    if (path === null) return;
    markdownPath = path;
    await writeTextFile(path, text.body);
}

async function loadButton() {
    document.querySelector('#menu').removeAttribute('open');
    const path = await open({
        multiple: false,
        directory: false,
        filters: [
            {
                name: 'Markdown',
                extensions: ['md']
            }
        ]
    });
    if (path === null) return;
    markdownPath = path;
    const content = await readTextFile(path);
    Object.assign(text, defaults);
    text.body = content;
    editor.dispatch({
        changes: {
            from: 0,
            to: editor.state.doc.length,
            insert: document.querySelector('#preamble-button').classList.contains('secondary') ? text.body : text.preamble
        }
    });
    document.querySelector('#extensions').value = text.extensions;
    document.querySelector('#pdf').innerHTML = '';
}

function settingsButton() {
    document.querySelector('#menu').removeAttribute('open');
    document.querySelector('#settings').setAttribute('open', '');
}

function closeSettingsButton() {
    document.querySelector('#settings').removeAttribute('open');
}

async function saveSettingsButton() {
    defaults.preamble = document.querySelector('#default-preamble-text').value;
    await store.set('preamble', defaults.preamble);
    defaults.body = document.querySelector('#default-body-text').value;
    await store.set('body', defaults.body);
    defaults.extensions = document.querySelector('#default-extensions').value;
    await store.set('extensions', defaults.extensions);
    await store.save();
    closeSettingsButton();
}

async function sourceCodeButton() {
    document.querySelector('#menu').removeAttribute('open');
    await openUrl('https://github.com/slashinfty/mdTeX');
}

function preambleButton() {
    const button = document.querySelector('#preamble-button');
    if (!button.classList.contains('secondary')) return;
    button.classList.toggle('secondary');
    document.querySelector('#body-button').classList.toggle('secondary');
    editor.dispatch({
        effects: language.reconfigure(new LanguageSupport(latexLanguage)),
        changes: {
            from: 0,
            to: editor.state.doc.length,
            insert: text.preamble
        }
    });
}

function bodyButton() {
    const button = document.querySelector('#body-button');
    if (!button.classList.contains('secondary')) return;
    button.classList.toggle('secondary');
    document.querySelector('#preamble-button').classList.toggle('secondary');
    editor.dispatch({
        effects: language.reconfigure(markdown()),
        changes: {
            from: 0,
            to: editor.state.doc.length,
            insert: text.body
        }
    });
}

async function extensionsLink() {
    await openUrl('https://pandoc.org/MANUAL.html#extensions');
}

function extensions() {
    text.extensions = document.querySelector('#extensions').value;
}

function closeErrorButton() {
    document.querySelector('#error').removeAttribute('open');
}

async function compile() {
    document.querySelector('#compile-button').setAttribute('aria-busy', 'true');
    if (markdownPath === '') {
        const path = await save({
            filters: [
                {
                    name: 'Markdown',
                    extensions: ['md']
                }
            ]
        });
        if (path === null) {
            document.querySelector('#compile-button').removeAttribute('aria-busy');   
            return;
        }
        markdownPath = path;
    }
    await writeTextFile(markdownPath, text.body);
    const path = await dirname(markdownPath);
    const fileName = await basename(markdownPath, '.md');
    const yamlFile = await resolve(path, `${fileName}.yaml`);
    await writeTextFile(yamlFile, `---\nheader-includes: |\n\t${text.preamble.replace(/\n/gm, `\n\t`)}\n...`);
    const pdfFile = await resolve(path, `${fileName}.pdf`);
    const pandoc = Command.create('pandoc', ['--from', `markdown${text.extensions}`, '--to', document.querySelector('#export').value, '--output', pdfFile, yamlFile, markdownPath]);
    const result = await pandoc.execute();
    document.querySelector('#pdf').innerHTML = '';
    if (result.stderr !== '') {
        console.error(result.stderr);
        document.querySelector('#error-text').innerHTML = result.stderr;
        document.querySelector('#error').setAttribute('open', '');
    } else {
        const pdfArr = await readFile(pdfFile);
        const el = document.createElement('embed');
        el.src = URL.createObjectURL(new Blob([pdfArr], { type: 'application/pdf' }));
        el.type = 'application/pdf';
        el.width = '100%';
        el.height = '100%';
        document.querySelector('#pdf').appendChild(el);
    }
    await remove(yamlFile);
    document.querySelector('#compile-button').removeAttribute('aria-busy');
}

window.addEventListener('DOMContentLoaded', async () => {
    store = new LazyStore('settings.json', {
        defaults: {
            preamble: '',
            body: '',
            extensions: ''
        }
    });
    await store.save();
    const state = EditorState.create({
        extensions: [
            solarizedDark,
            language.of(markdown()),
            history(),
            indentOnInput(),
            syntaxHighlighting(defaultHighlightStyle),
            bracketMatching(),
            closeBrackets(),
            highlightActiveLine(),
            highlightSelectionMatches(),
            keymap.of([
                ...closeBracketsKeymap,
                ...defaultKeymap,
                ...historyKeymap
            ]),
            EditorView.updateListener.of(v => {
                let newText;
                if (v.state.doc.hasOwnProperty('text') && (!v.startState.doc.hasOwnProperty('text') || v.state.doc.text.toString() !== v.startState.doc.text.toString())) {
                    newText = v.state.doc.text.join(`\n`);
                }
                if (v.state.doc.hasOwnProperty('children') && (!v.startState.doc.hasOwnProperty('children') || v.state.doc.children.reduce((str, child) => str + child.text.toString(), '') !== v.startState.doc.children.reduce((str, child) => str + child.text.toString(), ''))) {
                    newText = v.state.doc.children.map(child => child.text).flat().join(`\n`);
                }
                if (newText === undefined) return;
                if (document.querySelector('#body-button').classList.contains('secondary')) {
                    text.preamble = newText;
                } else {
                    text.body = newText;
                }
            })
        ]
    });
    editor = new EditorView({
        parent: document.querySelector('#textarea'),
        doc: '',
        state
    });
    await initialize();

    document.querySelector('#new-button').addEventListener('click', newButton);
    document.querySelector('#save-button').addEventListener('click', saveButton);
    document.querySelector('#save-as-button').addEventListener('click', saveAsButton);
    document.querySelector('#load-button').addEventListener('click', loadButton);
    document.querySelector('#settings-button').addEventListener('click', settingsButton);
    document.querySelector('#close-settings-button').addEventListener('click', closeSettingsButton);
    document.querySelector('#save-settings-button').addEventListener('click', saveSettingsButton);
    document.querySelector('#source-code-button').addEventListener('click', sourceCodeButton);
    document.querySelector('#preamble-button').addEventListener('click', preambleButton);
    document.querySelector('#body-button').addEventListener('click', bodyButton);
    document.querySelector('#extensions-link').addEventListener('click', extensionsLink);
    document.querySelector('#extensions').addEventListener('input', extensions);
    document.querySelector('#compile-button').addEventListener('click', compile);
    document.querySelector('#close-error-button').addEventListener('click', closeErrorButton);
});
