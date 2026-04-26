declare module "qrcode-terminal" {
  interface Options {
    small?: boolean
  }
  const qrcode: {
    generate(text: string, optionsOrCallback?: Options | ((qr: string) => void), callback?: (qr: string) => void): void
    setErrorLevel(level: "L" | "M" | "Q" | "H"): void
  }
  export default qrcode
}
