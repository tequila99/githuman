import type { ITheme } from '@xterm/xterm'

export function terminalTheme(dark: boolean): ITheme {
  return dark
    ? {
        background: '#171a21',
        foreground: '#e5e9f0',
        cursor: '#e5e9f0',
        selectionBackground: '#54719a80',
        black: '#303642',
        red: '#f07883',
        green: '#a6d189',
        yellow: '#e5c890',
        blue: '#8caaee',
        magenta: '#ca9ee6',
        cyan: '#81c8be',
        white: '#d9e0ee',
        brightBlack: '#737b91',
        brightRed: '#ff97a0',
        brightGreen: '#c1e5a7',
        brightYellow: '#f5dcad',
        brightBlue: '#adc4ff',
        brightMagenta: '#e4bbff',
        brightCyan: '#a4e4dc',
        brightWhite: '#ffffff'
      }
    : {
        background: '#fafbfc',
        foreground: '#252c39',
        cursor: '#252c39',
        selectionBackground: '#6485c340',
        black: '#252c39',
        red: '#a82e40',
        green: '#356b29',
        yellow: '#815800',
        blue: '#254eac',
        magenta: '#80399e',
        cyan: '#11686a',
        white: '#c7cbd2',
        brightBlack: '#656e80',
        brightRed: '#bb3248',
        brightGreen: '#41782f',
        brightYellow: '#926200',
        brightBlue: '#315fbe',
        brightMagenta: '#9146ae',
        brightCyan: '#21767a',
        brightWhite: '#ffffff'
      }
}
