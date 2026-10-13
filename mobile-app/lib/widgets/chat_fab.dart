import 'dart:async';

import 'package:flutter/material.dart';

import '../core/push.dart';
import '../core/i18n.dart';
import '../core/theme.dart';
import '../screens/shared/chat_screens.dart';
import 'common.dart';

/// Round chat button (bottom right, above the Menu tab) with the unread count.
/// Opens team chat in one tap; the count refreshes every 15 s.
class ChatFab extends StatefulWidget {
  const ChatFab({super.key});
  @override
  State<ChatFab> createState() => _ChatFabState();
}

class _ChatFabState extends State<ChatFab> with WidgetsBindingObserver {
  int _unread = 0;
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    liveTick.addListener(_refresh);
    _refresh();
    // Only while the app is on screen (no network use in the background).
    _timer = Timer.periodic(const Duration(seconds: 15), (_) {
      if (WidgetsBinding.instance.lifecycleState == AppLifecycleState.resumed) _refresh();
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    liveTick.removeListener(_refresh);
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) _refresh();
  }

  Future<void> _refresh() async {
    try {
      final r = await apiOf(context).getData<Map<String, dynamic>>('/chats/unread');
      if (mounted) setState(() => _unread = (r['count'] ?? 0) as int);
    } catch (_) {
      // Keep the last count when offline.
    }
  }

  @override
  Widget build(BuildContext context) {
    return Tooltip(
      message: t('Chat'),
      child: FloatingActionButton(
        heroTag: 'chat-fab',
        backgroundColor: Colors.white,
        foregroundColor: AppColors.primary,
        elevation: 4,
        shape: const CircleBorder(side: BorderSide(color: Color(0xFFC7D2FE))),
        onPressed: () async {
          await Navigator.of(context).push(MaterialPageRoute(builder: (_) => const ChatListScreen()));
          _refresh();
        },
        child: Badge(
          isLabelVisible: _unread > 0,
          label: Text(_unread > 99 ? '99+' : '$_unread'),
          offset: const Offset(10, -10),
          child: const Icon(Icons.chat_bubble_outline_rounded, size: 26),
        ),
      ),
    );
  }
}
