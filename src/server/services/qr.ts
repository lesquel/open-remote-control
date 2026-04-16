import qrcode from "qrcode-terminal"

export function generateQR(url: string): Promise<string> {
  return new Promise((resolve) => {
    qrcode.generate(url, { small: true }, (qr) => {
      resolve(qr)
    })
  })
}
