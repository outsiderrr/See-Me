import SwiftUI

struct LoginView: View {
    @EnvironmentObject var api: APIClient
    @State private var phone = ""
    @State private var code = ""
    @State private var codeSent = false
    @State private var message = ""
    @State private var busy = false

    var body: some View {
        VStack(spacing: 16) {
            Spacer()
            Text("See Me").font(.system(size: 34, weight: .semibold))
            Text("把想被了解的那部分自己,写在这里。")
                .font(.subheadline).foregroundStyle(.secondary)

            VStack(spacing: 12) {
                TextField("手机号", text: $phone)
                    .keyboardType(.phonePad)
                    .textFieldStyle(.roundedBorder)
                if codeSent {
                    TextField("6 位验证码", text: $code)
                        .keyboardType(.numberPad)
                        .textFieldStyle(.roundedBorder)
                }
                Button(codeSent ? "登录" : "发送验证码") { Task { await go() } }
                    .buttonStyle(.borderedProminent)
                    .disabled(busy)
                Text(message).font(.footnote).foregroundStyle(.secondary)
                    .frame(minHeight: 18)
            }
            .padding(.top, 24)
            Spacer()
        }
        .padding(.horizontal, 28)
    }

    func go() async {
        busy = true
        defer { busy = false }
        do {
            if !codeSent {
                guard phone.range(of: "^\\+?\\d{8,15}$", options: .regularExpression) != nil else {
                    message = "手机号格式不对"; return
                }
                try await api.requestCode(phone: phone)
                codeSent = true
                message = "验证码已发送(开发期看后端终端)"
            } else {
                try await api.verify(phone: phone, code: code)
                // logged in -> SeeMeApp swaps to LibraryView automatically
            }
        } catch APIClient.APIError.status(let s) {
            message = s == 429 ? "太频繁了,稍后再试" : (codeSent ? "验证码不对" : "发送失败")
        } catch {
            message = "网络错误,检查后端是否在跑"
        }
    }
}
