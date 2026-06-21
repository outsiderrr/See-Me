import Foundation

@MainActor
final class LibraryStore: ObservableObject {
    @Published var notes: [NoteDTO] = []
    @Published var tags: [TagDTO] = []
    @Published var me: APIUser?
    @Published var receivedCards: [ReceivedCardDTO] = []
    @Published var activeOwnTagId: String?
    @Published var selectedCardId: String?
    @Published var readerHeader: ReaderHeaderResponse?
    @Published var readerNotes: [ReaderNoteDTO] = []
    @Published var activeShareId: String?
    @Published var message = ""

    var selectedCard: ReceivedCardDTO? {
        receivedCards.first { $0.id == selectedCardId }
    }

    var pinnedTags: [TagDTO] { tags.filter { $0.isPinned == true } }

    func loadAll(_ api: APIClient) async {
        do {
            async let loadedNotes = api.listNotes(tagId: activeOwnTagId)
            async let loadedTags = api.listTags()
            async let loadedMe = api.me()
            async let loadedCards = api.listReceivedCards()
            notes = try await loadedNotes
            tags = try await loadedTags
            me = try await loadedMe
            receivedCards = try await loadedCards
        } catch {
            message = "暂时没载入成功，请稍后再试。"
        }
        if selectedCardId != nil { await reloadReader(api) }
    }

    func reloadOwn(_ api: APIClient) async {
        do {
            async let loadedNotes = api.listNotes(tagId: activeOwnTagId)
            async let loadedTags = api.listTags()
            async let loadedMe = api.me()
            notes = try await loadedNotes
            tags = try await loadedTags
            me = try await loadedMe
        } catch {
            message = "自己的库暂时没载入成功。"
        }
    }

    func showAllNotes(_ api: APIClient) async {
        selectedCardId = nil
        readerHeader = nil
        readerNotes = []
        activeShareId = nil
        activeOwnTagId = nil
        await reloadOwn(api)
    }

    func showOwnTag(_ id: String, api: APIClient) async {
        selectedCardId = nil
        readerHeader = nil
        readerNotes = []
        activeShareId = nil
        activeOwnTagId = id
        await reloadOwn(api)
    }

    func toggleReceivedCard(_ card: ReceivedCardDTO, api: APIClient) async {
        if selectedCardId == card.id {
            await showAllNotes(api)
            return
        }
        selectedCardId = card.id
        activeShareId = nil
        await reloadReader(api)
    }

    func showShare(_ id: String?, api: APIClient) async {
        activeShareId = id
        await reloadReaderNotes(api)
    }

    func reloadReader(_ api: APIClient) async {
        guard let cardId = selectedCardId else { return }
        do {
            async let header = api.readerHeader(cardId: cardId)
            async let loadedNotes = api.readerNotes(cardId: cardId, tab: activeShareId)
            readerHeader = try await header
            readerNotes = try await loadedNotes
        } catch {
            message = "这张邀请卡现在无法读取。"
            selectedCardId = nil
            readerHeader = nil
            readerNotes = []
        }
    }

    func reloadReaderNotes(_ api: APIClient) async {
        guard let cardId = selectedCardId else { return }
        readerNotes = (try? await api.readerNotes(cardId: cardId, tab: activeShareId)) ?? []
    }

    func redeem(_ raw: String, api: APIClient) async {
        let code = raw.components(separatedBy: .whitespacesAndNewlines).joined().uppercased()
        do {
            let cardId = try await api.redeem(code: code)
            receivedCards = try await api.listReceivedCards()
            selectedCardId = cardId
            activeShareId = nil
            message = "邀请卡已载入。"
            await reloadReader(api)
        } catch APIClient.APIError.status(let status) {
            message = status == 429 ? "尝试太频繁，请稍后再试。" : "没有找到这张邀请卡。"
        } catch {
            message = "邀请码载入失败。"
        }
    }

    func setPinned(_ tag: TagDTO, pinned: Bool, api: APIClient) async {
        do {
            try await api.updateTag(id: tag.id, pinned: pinned)
            tags = try await api.listTags()
        } catch {
            message = "标签状态没有保存成功。"
        }
    }

    func editTag(_ tag: TagDTO, name: String, icon: String, api: APIClient) async {
        do {
            try await api.updateTag(id: tag.id, name: name, icon: icon)
            tags = try await api.listTags()
            notes = try await api.listNotes(tagId: activeOwnTagId)
        } catch APIClient.APIError.status(let status) {
            message = status == 409 ? "已经有同名标签。" : "标签没有保存成功。"
        } catch {
            message = "标签没有保存成功。"
        }
    }

    func deleteTag(_ tag: TagDTO, deleteNotes: Bool, api: APIClient) async {
        do {
            try await api.deleteTag(id: tag.id, deleteNotes: deleteNotes)
            if activeOwnTagId == tag.id { activeOwnTagId = nil }
            await reloadOwn(api)
        } catch {
            message = "标签没有删除成功。"
        }
    }
}
