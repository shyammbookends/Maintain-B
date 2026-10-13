import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/api.dart';
import '../../core/format.dart';
import '../../core/i18n.dart';
import '../../core/push.dart';
import '../../core/session.dart';
import '../../core/theme.dart';
import '../../widgets/common.dart';
import '../../widgets/voice_message.dart';
import 'work_order_screen.dart';

/*
 * Live team chat. An open conversation asks the server for messages newer than
 * the last one every 2.5 s (`?after=<id>`), the list refreshes every 5 s, and
 * both pause while the app is in the background.
 *
 * Super Admins and Admins can switch the list to "All chats" (`?scope=all`):
 * chats they are not in open read-only (no composer, a banner instead).
 *
 * Voice messages: with an empty text box the send button is a mic; tap it to
 * record (timer, cancel, send). Recorded offline, they wait in the offline
 * queue like work-order photos.
 */

const _roomPoll = Duration(milliseconds: 2500);
const _listPoll = Duration(seconds: 5);

/// Runs [tick] on an interval while the app is in the foreground.
mixin _LivePolling<T extends StatefulWidget> on State<T>, WidgetsBindingObserver {
  Timer? _timer;
  Duration get pollEvery;
  Future<void> tick();

  void startPolling() {
    WidgetsBinding.instance.addObserver(this);
    _schedule();
  }

  void _schedule() {
    _timer?.cancel();
    _timer = Timer.periodic(pollEvery, (_) => tick());
  }

  void stopPolling() {
    _timer?.cancel();
    WidgetsBinding.instance.removeObserver(this);
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      tick();
      _schedule();
    } else if (state == AppLifecycleState.paused) {
      _timer?.cancel();
    }
  }
}

class ChatListScreen extends StatefulWidget {
  const ChatListScreen({super.key});
  @override
  State<ChatListScreen> createState() => _ChatListScreenState();
}

class _ChatListScreenState extends State<ChatListScreen> with WidgetsBindingObserver, _LivePolling {
  List? _chats;
  Object? _error;
  bool _busy = false;

  /// Admins: show every chat they oversee too.
  bool _all = false;

  bool get _isAdmin {
    final s = context.read<Session>();
    return s.isAdmin || s.isSuperAdmin;
  }

  @override
  Duration get pollEvery => _listPoll;

  @override
  void initState() {
    super.initState();
    tick();
    startPolling();
    liveTick.addListener(tick);
  }

  @override
  void dispose() {
    liveTick.removeListener(tick);
    stopPolling();
    super.dispose();
  }

  @override
  Future<void> tick() async {
    if (_busy) return;
    _busy = true;
    final all = _all;
    try {
      final c = await apiOf(context).getData<List>('/chats', all ? {'scope': 'all'} : null);
      // The switch moved while loading: this answer is for the other list.
      if (mounted && all != _all) {
        _busy = false;
        await tick();
        return;
      }
      if (mounted) {
        setState(() {
          _chats = c;
          _error = null;
        });
      }
    } catch (e) {
      if (mounted && _chats == null) setState(() => _error = e);
    } finally {
      _busy = false;
    }
  }

  @override
  Widget build(BuildContext context) {
    final chats = _chats;
    return Scaffold(
      appBar: AppBar(
        title: Text(t('Chat')),
        bottom: _isAdmin
            ? PreferredSize(
                preferredSize: const Size.fromHeight(56),
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(16, 0, 16, 10),
                  child: SizedBox(
                    width: double.infinity,
                    child: SegmentedButton<bool>(
                      segments: [
                        ButtonSegment(value: false, label: Text(t('My chats'))),
                        ButtonSegment(
                            value: true,
                            icon: const Icon(Icons.visibility_outlined, size: 18),
                            label: Text(t('All chats'))),
                      ],
                      selected: {_all},
                      showSelectedIcon: false,
                      onSelectionChanged: (v) {
                        setState(() {
                          _all = v.first;
                          _chats = null;
                          _error = null;
                        });
                        tick();
                      },
                    ),
                  ),
                ),
              )
            : null,
      ),
      body: chats == null
          ? (_error != null ? ErrorView(error: _error!, onRetry: tick) : const Center(child: CircularProgressIndicator()))
          : RefreshIndicator(
              onRefresh: tick,
              child: chats.isEmpty
                  ? ListView(children: [EmptyState(icon: Icons.forum_outlined, title: t('No conversations yet'))])
                  : ListView.separated(
                      itemCount: chats.length,
                      separatorBuilder: (_, _) => const Divider(indent: 72),
                      itemBuilder: (context, i) => _ChatTile(
                        chat: chats[i] as Map,
                        onOpen: () async {
                          final c = chats[i] as Map;
                          await Navigator.of(context).push(MaterialPageRoute(
                              builder: (_) => ChatRoomScreen(
                                  id: c['id'].toString(),
                                  title: c['title'].toString(),
                                  viewOnly: c['viewOnly'] == true)));
                          tick();
                        },
                      ),
                    ),
            ),
    );
  }
}

/// Last message text, or "🎤 Voice message (0:12)".
String _previewBody(Map last) {
  final sec = last['voiceSec'] as num?;
  final body = (last['body'] ?? '').toString();
  if (sec == null) return body;
  final voice = '🎤 ${t('Voice message ({duration})', {'duration': fmtVoice(sec)})}';
  return body.isEmpty ? voice : '$voice · $body';
}

class _ChatTile extends StatelessWidget {
  const _ChatTile({required this.chat, required this.onOpen});
  final Map chat;
  final VoidCallback onOpen;
  @override
  Widget build(BuildContext context) {
    final last = chat['lastMessage'] as Map?;
    final unread = (chat['unread'] ?? 0) as int;
    return ListTile(
      leading: chat['type'] == 'GROUP'
          ? const IconChip(Icons.groups_outlined, size: 44, brand: true)
          : Avatar(((chat['members'] as List?)?.firstOrNull), size: 44),
      title: Row(children: [
        Flexible(
          child: Text(chat['title'].toString(),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(fontWeight: unread > 0 ? FontWeight.w700 : FontWeight.w600)),
        ),
        if (chat['viewOnly'] == true) ...[
          const SizedBox(width: 6),
          Icon(Icons.visibility_outlined, size: 16, color: toneColors('warning').fg, semanticLabel: t('View only')),
        ],
      ]),
      subtitle: Text(last == null ? t('No messages') : '${last['authorName']}: ${_previewBody(last)}',
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: TextStyle(color: unread > 0 ? AppColors.foreground : AppColors.muted)),
      trailing: Column(mainAxisAlignment: MainAxisAlignment.center, crossAxisAlignment: CrossAxisAlignment.end, children: [
        Text(fmtRelative(last?['createdAt'] ?? chat['lastMessageAt']),
            style: TextStyle(fontSize: 11.5, color: unread > 0 ? AppColors.primary : AppColors.muted)),
        if (unread > 0) ...[
          const SizedBox(height: 4),
          Container(
            constraints: const BoxConstraints(minWidth: 20),
            padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
            decoration: BoxDecoration(color: AppColors.primary, borderRadius: BorderRadius.circular(10)),
            child: Text(unread > 99 ? '99+' : '$unread',
                textAlign: TextAlign.center,
                style: const TextStyle(fontSize: 11, color: Colors.white, fontWeight: FontWeight.w600)),
          ),
        ],
      ]),
      onTap: onOpen,
    );
  }
}

class ChatRoomScreen extends StatefulWidget {
  const ChatRoomScreen({super.key, required this.id, required this.title, this.viewOnly = false});
  final String id;
  final String title;

  /// An admin overseeing a chat they are not in: read only, never marked read.
  final bool viewOnly;
  @override
  State<ChatRoomScreen> createState() => _ChatRoomScreenState();
}

class _ChatRoomScreenState extends State<ChatRoomScreen> with WidgetsBindingObserver, _LivePolling {
  final _ctrl = TextEditingController();
  final _scroll = ScrollController();
  /// Oldest first.
  final List<Map> _messages = [];
  final Set<String> _ids = {};
  bool _loading = true;
  bool _hasMore = false;
  bool _loadingOlder = false;
  bool _sending = false;
  bool _polling = false;
  Object? _error;
  late final _voice = VoiceRecorder(onAutoStop: (clip) {
    if (!mounted) return;
    toast(context, t('Voice messages can be up to 3 minutes. Sending it now.'));
    _sendVoice(clip);
  });
  bool _voiceSending = false;

  ApiClient get api => apiOf(context);

  @override
  Duration get pollEvery => _roomPoll;

  @override
  void initState() {
    super.initState();
    _loadLatest();
    startPolling();
    _ctrl.addListener(_onText);
    _voice.addListener(_onText);
  }

  void _onText() {
    if (mounted) setState(() {});
  }

  @override
  void dispose() {
    stopPolling();
    _voice.dispose();
    _scroll.dispose();
    super.dispose();
  }

  void _add(Iterable<Map> list, {bool older = false}) {
    final fresh = [for (final m in list) if (_ids.add(m['id'].toString())) m];
    if (fresh.isEmpty) return;
    older ? _messages.insertAll(0, fresh) : _messages.addAll(fresh);
  }

  void _markRead() {
    if (widget.viewOnly) return;
    api.post('/chats/${widget.id}/read').catchError((_) => null);
  }

  Future<void> _loadLatest() async {
    try {
      final page = await api.getData<Json>('/chats/${widget.id}/messages');
      if (!mounted) return;
      setState(() {
        _messages.clear();
        _ids.clear();
        _add(((page['messages'] as List?) ?? const []).cast<Map>());
        _hasMore = page['hasMore'] == true;
        _loading = false;
        _error = null;
      });
      _markRead();
    } catch (e) {
      if (mounted) {
        setState(() {
          _error = e;
          _loading = false;
        });
      }
    }
  }

  /// New messages since the last one we have.
  @override
  Future<void> tick() async {
    if (_polling || _loading || _messages.isEmpty && _error != null) return;
    _polling = true;
    try {
      final after = _messages.isEmpty ? null : _messages.last['id'];
      final page = await api.getData<Json>('/chats/${widget.id}/messages', {'after': after});
      final list = ((page['messages'] as List?) ?? const []).cast<Map>();
      if (!mounted || list.isEmpty) return;
      final atBottom = !_scroll.hasClients || _scroll.offset < 80;
      setState(() => _add(list));
      if (atBottom) _toBottom();
      if (list.any((m) => m['mine'] != true)) _markRead();
    } catch (_) {
      // Offline for a moment: try again on the next tick.
    } finally {
      _polling = false;
    }
  }

  Future<void> _loadOlder() async {
    if (_loadingOlder || _messages.isEmpty) return;
    setState(() => _loadingOlder = true);
    try {
      final page = await api.getData<Json>('/chats/${widget.id}/messages', {'before': _messages.first['id']});
      if (!mounted) return;
      setState(() {
        _add(((page['messages'] as List?) ?? const []).cast<Map>(), older: true);
        _hasMore = page['hasMore'] == true;
      });
    } catch (e) {
      if (mounted) toast(context, errorText(e), error: true);
    } finally {
      if (mounted) setState(() => _loadingOlder = false);
    }
  }

  void _toBottom() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scroll.hasClients) {
        _scroll.animateTo(0, duration: const Duration(milliseconds: 250), curve: Curves.easeOut);
      }
    });
  }

  /// Removes one of your own messages (shown as "Message deleted" to everyone).
  Future<void> _delete(Map m) async {
    if (!await confirm(context, t('Delete this message?'), action: t('Delete')) || !mounted) return;
    try {
      await api.delete('/chats/${widget.id}/messages/${m['id']}');
      if (mounted) setState(() => m['deleted'] = true);
    } catch (e) {
      if (mounted) toast(context, errorText(e), error: true);
    }
  }

  Future<void> _send() async {
    final text = _ctrl.text.trim();
    if (text.isEmpty || _sending) return;
    setState(() => _sending = true);
    try {
      final m = await api.postData<Json>('/chats/${widget.id}/messages', {'body': text, 'workOrderId': ''});
      _ctrl.clear();
      if (mounted) setState(() => _add([m]));
      _toBottom();
    } catch (e) {
      if (mounted) toast(context, errorText(e), error: true);
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  Future<void> _startVoice() async {
    try {
      if (!await _voice.start() && mounted) micDenied(context);
    } catch (e) {
      if (mounted) toast(context, t('Can’t use the microphone on this phone.'), error: true);
    }
  }

  /// Send ✓ while recording: stop, then upload (the bar stays up meanwhile).
  Future<void> _finishVoice() async {
    if (_voiceSending) return;
    setState(() => _voiceSending = true);
    final clip = await _voice.finish();
    await _sendVoice(clip, started: true);
  }

  Future<void> _sendVoice(VoiceClip? clip, {bool started = false}) async {
    if (clip == null || (_voiceSending && !started)) {
      if (started && mounted) setState(() => _voiceSending = false);
      return;
    }
    setState(() => _voiceSending = true);
    try {
      final m = await api.upload('/chats/${widget.id}/voice', [clip.file], {'durationSec': '${clip.seconds}', 'body': ''});
      if (mounted) setState(() => _add([m]));
      _toBottom();
    } on ApiException catch (e) {
      // Without a network it waits on the phone and goes out when back online.
      if (mounted) toast(context, e.queued ? e.message : errorText(e), error: !e.queued);
    } catch (e) {
      if (mounted) toast(context, errorText(e), error: true);
    } finally {
      if (mounted) setState(() => _voiceSending = false);
      // The offline queue keeps its own copy.
      unawaited(clip.file.delete().then((_) => null, onError: (_) => null));
    }
  }

  Widget _composer() {
    if (_voice.recording || _voiceSending) {
      return RecordingBar(
        seconds: _voice.seconds,
        sending: _voiceSending,
        onCancel: _voice.cancel,
        onSend: _finishVoice,
      );
    }
    final empty = _ctrl.text.trim().isEmpty;
    return Row(children: [
      Expanded(
        child: TextField(
          controller: _ctrl,
          minLines: 1,
          maxLines: 4,
          textCapitalization: TextCapitalization.sentences,
          onSubmitted: (_) => _send(),
          decoration: InputDecoration(
            hintText: t('Message'),
            isDense: true,
            fillColor: AppColors.neutralSoft,
            border: OutlineInputBorder(borderRadius: BorderRadius.circular(22), borderSide: BorderSide.none),
            enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(22), borderSide: BorderSide.none),
            focusedBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(22), borderSide: const BorderSide(color: AppColors.primary)),
          ),
        ),
      ),
      const SizedBox(width: 6),
      if (empty && !_sending)
        IconButton.filled(
          tooltip: t('Record a voice message'),
          onPressed: _startVoice,
          style: IconButton.styleFrom(backgroundColor: AppColors.primary, foregroundColor: Colors.white),
          icon: const Icon(Icons.mic_rounded),
        )
      else
        IconButton.filled(
          onPressed: _sending ? null : _send,
          style: IconButton.styleFrom(backgroundColor: AppColors.primary, foregroundColor: Colors.white),
          icon: _sending
              ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
              : const Icon(Icons.send_rounded),
        ),
    ]);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(widget.title),
          if (widget.viewOnly)
            Pill(t('View only'), tone: 'warning', icon: Icons.visibility_outlined)
          else
            Row(children: [
              Container(
                  width: 7,
                  height: 7,
                  decoration: const BoxDecoration(color: AppColors.success, shape: BoxShape.circle)),
              const SizedBox(width: 5),
              Text(t('Live'),
                  style: const TextStyle(fontSize: 12, color: AppColors.muted, fontWeight: FontWeight.w500)),
            ]),
        ]),
      ),
      body: Column(children: [
        Expanded(
          child: _loading
              ? const Center(child: CircularProgressIndicator())
              : _error != null && _messages.isEmpty
                  ? ErrorView(error: _error!, onRetry: _loadLatest)
                  : RefreshIndicator(
                      onRefresh: _loadLatest,
                      child: ListView.builder(
                        controller: _scroll,
                        reverse: true, // newest at the bottom
                        padding: const EdgeInsets.fromLTRB(12, 12, 12, 12),
                        itemCount: _messages.length + (_hasMore ? 1 : 0),
                        itemBuilder: (context, i) {
                          if (i == _messages.length) {
                            return Center(
                              child: TextButton(
                                onPressed: _loadingOlder ? null : _loadOlder,
                                child: Text(_loadingOlder ? t('Loading…') : t('Load earlier messages')),
                              ),
                            );
                          }
                          final m = _messages[_messages.length - 1 - i];
                          final prev = _messages.length - 2 - i >= 0 ? _messages[_messages.length - 2 - i] : null;
                          final sameAuthor = prev != null && (prev['author'] as Map?)?['id'] == (m['author'] as Map?)?['id'];
                          return _Bubble(
                              key: ValueKey(m['id']),
                              message: m,
                              showName: !sameAuthor,
                              onDelete: widget.viewOnly ? null : () => _delete(m));
                        },
                      ),
                    ),
        ),
        if (widget.viewOnly)
          SafeArea(
            top: false,
            child: Container(
              width: double.infinity,
              color: toneColors('warning').bg,
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
              child: Row(children: [
                Icon(Icons.visibility_outlined, size: 20, color: toneColors('warning').fg),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(t("You are viewing this chat as an admin. You can't send messages here."),
                      style:
                          TextStyle(fontSize: 13.5, fontWeight: FontWeight.w500, color: toneColors('warning').fg)),
                ),
              ]),
            ),
          )
        else
          SafeArea(
            top: false,
            child: Container(
              decoration: const BoxDecoration(color: Colors.white, border: Border(top: BorderSide(color: AppColors.border))),
              padding: const EdgeInsets.fromLTRB(12, 8, 8, 8),
              child: _composer(),
            ),
          ),
      ]),
    );
  }
}

class _Bubble extends StatelessWidget {
  const _Bubble({super.key, required this.message, required this.showName, this.onDelete});
  final Map message;
  final bool showName;
  final VoidCallback? onDelete;

  @override
  Widget build(BuildContext context) {
    final m = message;
    final mine = m['mine'] == true;
    final wo = m['workOrder'] as Map?;
    final voice = m['voice'] as Map?;
    final canDelete = mine && m['deleted'] != true && onDelete != null;
    return Align(
      alignment: mine ? Alignment.centerRight : Alignment.centerLeft,
      child: GestureDetector(
        // Your own messages: long-press to delete.
        onLongPress: canDelete ? onDelete : null,
        child: Container(
        margin: EdgeInsets.only(top: showName ? 8 : 2),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        constraints: BoxConstraints(maxWidth: MediaQuery.of(context).size.width * 0.78),
        decoration: BoxDecoration(
          color: mine ? AppColors.primary : Colors.white,
          borderRadius: BorderRadius.only(
            topLeft: const Radius.circular(16),
            topRight: const Radius.circular(16),
            bottomLeft: Radius.circular(mine ? 16 : 4),
            bottomRight: Radius.circular(mine ? 4 : 16),
          ),
          border: mine ? null : Border.all(color: AppColors.border),
        ),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          if (!mine && showName)
            Text(personName(m['author']),
                style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: AppColors.primary)),
          if (voice != null && m['deleted'] != true)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 2),
              child: VoicePlayer(
                  voice: voice, seed: m['id'].toString(), mine: mine, url: apiOf(context).fileUrl(voice['url']?.toString())),
            ),
          if (m['deleted'] == true || voice == null || (m['body'] ?? '').toString().isNotEmpty)
            Text(m['deleted'] == true ? t('Message deleted') : m['body'].toString(),
                style: TextStyle(
                    color: mine ? Colors.white : AppColors.foreground,
                    fontSize: 14.5,
                    fontStyle: m['deleted'] == true ? FontStyle.italic : null)),
          if (wo != null)
            InkWell(
              onTap: () => Navigator.of(context)
                  .push(MaterialPageRoute(builder: (_) => WorkOrderScreen(id: wo['id'].toString()))),
              child: Padding(
                padding: const EdgeInsets.only(top: 4),
                child: Text('${wo['code'] ?? t('Work order')} ${wo['title'] ?? ''}',
                    style: TextStyle(
                        fontSize: 12.5,
                        decoration: TextDecoration.underline,
                        color: mine ? Colors.white : AppColors.primary)),
              ),
            ),
          const SizedBox(height: 2),
          Align(
            alignment: Alignment.bottomRight,
            child: Text(fmtTime(m['createdAt']),
                style: TextStyle(fontSize: 10.5, color: mine ? Colors.white70 : AppColors.muted)),
          ),
        ]),
      ),
      ),
    );
  }
}
