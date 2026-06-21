import Foundation

@MainActor
final class APIClient: ObservableObject {
    /// Simulator -> http://localhost:3000 ; real device -> your Mac's LAN IP ; prod -> https domain.
    static let baseURL = "http://localhost:3000"

    @Published var token: String? = UserDefaults.standard.string(forKey: "see_me_token")
    var isLoggedIn: Bool { token != nil }

    enum APIError: Error { case status(Int), decode, badURL }

    func setToken(_ t: String?) {
        token = t
        if let t { UserDefaults.standard.set(t, forKey: "see_me_token") }
        else { UserDefaults.standard.removeObject(forKey: "see_me_token") }
    }

    private func request(_ path: String, method: String = "GET", body: [String: Any]? = nil) async throws -> Data {
        guard let url = URL(string: APIClient.baseURL + path) else { throw APIError.badURL }
        var req = URLRequest(url: url)
        req.httpMethod = method
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let token { req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        if let body { req.httpBody = try JSONSerialization.data(withJSONObject: body) }
        let (data, resp) = try await URLSession.shared.data(for: req)
        let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
        if code == 401 { setToken(nil) }
        guard (200..<300).contains(code) else { throw APIError.status(code) }
        return data
    }

    private func decode<T: Decodable>(_ data: Data) throws -> T {
        do { return try JSONDecoder().decode(T.self, from: data) }
        catch { throw APIError.decode }
    }

    // MARK: Auth
    func requestCode(phone: String) async throws {
        _ = try await request("/api/auth/request-code", method: "POST", body: ["phone": phone])
    }
    func verify(phone: String, code: String) async throws {
        let auth: AuthResponse = try decode(try await request("/api/auth/verify", method: "POST", body: ["phone": phone, "code": code]))
        guard let t = auth.token else { throw APIError.decode }
        setToken(t)
    }
    func logout() async {
        _ = try? await request("/api/auth/logout", method: "POST")
        setToken(nil)
    }

    // MARK: Tags
    func listTags() async throws -> [TagDTO] {
        let r: TagsResponse = try decode(try await request("/api/tags"))
        return r.tags
    }
    func createTag(name: String) async throws -> TagDTO {
        let r: TagResponse = try decode(try await request("/api/tags", method: "POST", body: ["name": name]))
        return r.tag
    }

    // MARK: Notes
    func listNotes(tagId: String? = nil, q: String? = nil) async throws -> [NoteDTO] {
        var items: [String] = []
        if let tagId { items.append("tagId=\(tagId)") }
        if let q, !q.isEmpty, let enc = q.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) { items.append("q=\(enc)") }
        let path = "/api/notes" + (items.isEmpty ? "" : "?" + items.joined(separator: "&"))
        let r: NotesResponse = try decode(try await request(path))
        return r.notes
    }
    func createNote(body: String, tagIds: [String]) async throws -> NoteDTO {
        let r: NoteResponse = try decode(try await request("/api/notes", method: "POST", body: ["body": body, "tagIds": tagIds]))
        return r.note
    }

    // MARK: Cards (for the card-builder, next iteration)
    func listCards() async throws -> [CardDTO] {
        let r: CardsResponse = try decode(try await request("/api/cards"))
        return r.cards
    }
}
