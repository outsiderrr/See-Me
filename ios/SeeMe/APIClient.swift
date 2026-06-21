import Foundation

@MainActor
final class APIClient: ObservableObject {
    /// Simulator -> http://localhost:3000 ; real device -> your Mac's LAN IP ; prod -> https domain.
    static let baseURL = "http://localhost:3000"

    @Published var token: String? = UserDefaults.standard.string(forKey: "see_me_token")
    var isLoggedIn: Bool { token != nil }
    private lazy var session: URLSession = {
        let configuration = URLSessionConfiguration.default
        // This Mac may run a system proxy. Local simulator traffic must go straight
        // to the embedded backend instead of being tunneled to the proxy.
        if APIClient.baseURL.contains("localhost") || APIClient.baseURL.contains("127.0.0.1") {
            configuration.connectionProxyDictionary = [:]
        }
        return URLSession(configuration: configuration)
    }()

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
        let (data, resp) = try await session.data(for: req)
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
    func updateTag(id: String, name: String? = nil, icon: String? = nil, pinned: Bool? = nil) async throws {
        var body: [String: Any] = [:]
        if let name { body["name"] = name }
        if let icon { body["icon"] = icon }
        if let pinned { body["pinned"] = pinned }
        _ = try await request("/api/tags/\(id)", method: "PATCH", body: body)
    }
    func deleteTag(id: String, deleteNotes: Bool) async throws {
        _ = try await request(
            "/api/tags/\(id)",
            method: "DELETE",
            body: ["mode": deleteNotes ? "delete_notes" : "detach"]
        )
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
    func createNote(body: String, tagIds: [String], images: [Data] = []) async throws -> NoteDTO {
        let encoded = images.map { ["mimeType": "image/jpeg", "data": $0.base64EncodedString()] }
        let r: NoteResponse = try decode(try await request(
            "/api/notes",
            method: "POST",
            body: ["body": body, "tagIds": tagIds, "images": encoded]
        ))
        return r.note
    }

    // MARK: Profile + received cards
    func me() async throws -> APIUser {
        let r: MeResponse = try decode(try await request("/api/me"))
        return r.user
    }
    func listReceivedCards() async throws -> [ReceivedCardDTO] {
        let r: ReceivedCardsResponse = try decode(try await request("/api/my-cards"))
        return r.cards
    }
    func redeem(code: String) async throws -> String {
        let r: RedeemResponse = try decode(try await request("/api/redeem", method: "POST", body: ["code": code]))
        return r.cardId
    }
    func readerHeader(cardId: String) async throws -> ReaderHeaderResponse {
        try decode(try await request("/api/read/\(cardId)"))
    }
    func readerNotes(cardId: String, tab: String? = nil) async throws -> [ReaderNoteDTO] {
        let suffix = tab.map { "?tab=\($0)" } ?? ""
        let r: ReaderNotesResponse = try decode(try await request("/api/read/\(cardId)/notes\(suffix)"))
        return r.notes
    }
    func imageData(path: String) async throws -> Data {
        try await request(path)
    }

    // MARK: Cards
    func listCards() async throws -> [CardDTO] {
        let r: CardsResponse = try decode(try await request("/api/cards"))
        return r.cards
    }
    func cardDetail(id: String) async throws -> CardDTO {
        let r: CardResponse = try decode(try await request("/api/cards/\(id)"))
        return r.card
    }
    func createCard(title: String, shares: [[String: Any]]) async throws -> CardDTO {
        let r: CardResponse = try decode(try await request("/api/cards", method: "POST", body: ["title": title, "shares": shares]))
        return r.card
    }
    func advanceTime(cardId: String) async throws {
        _ = try await request("/api/cards/\(cardId)/advance", method: "POST")
    }
    func rotateCode(cardId: String) async throws -> String {
        let r: RotateResponse = try decode(try await request("/api/cards/\(cardId)/rotate-code", method: "POST"))
        return r.inviteCode
    }
    func addShare(cardId: String, share: [String: Any]) async throws {
        _ = try await request("/api/cards/\(cardId)/shares", method: "POST", body: share)
    }
    func removeShare(cardId: String, shareId: String) async throws {
        _ = try await request("/api/cards/\(cardId)/shares/\(shareId)", method: "DELETE")
    }
    func ownerPreview(cardId: String) async throws -> PreviewResponse {
        try decode(try await request("/api/cards/\(cardId)/preview"))
    }
}
