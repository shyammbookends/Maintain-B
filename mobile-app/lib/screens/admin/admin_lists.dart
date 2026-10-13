import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/format.dart';
import '../../core/i18n.dart';
import '../../core/theme.dart';
import '../../widgets/common.dart';
import 'editors.dart';

/// A paged API list rendered as cards, with an Add button for managers and
/// tap-to-open on each card.
class _ListScreen extends StatefulWidget {
  const _ListScreen({
    required this.title,
    required this.path,
    required this.item,
    this.emptyIcon = Icons.inbox_outlined,
    this.paged = true,
    this.addLabel,
    this.addPermission,
    this.addScreen,
    this.open,
  });
  final String title;
  final String path;
  final Widget Function(BuildContext, Map, VoidCallback? onTap, VoidCallback reload) item;
  final IconData emptyIcon;
  final bool paged;
  final String? addLabel;
  final String? addPermission;
  final Widget Function()? addScreen;
  /// Screen opened by tapping a card (null = not tappable).
  final Widget? Function(BuildContext, Map)? open;

  @override
  State<_ListScreen> createState() => _ListScreenState();
}

class _ListScreenState extends State<_ListScreen> {
  final _key = GlobalKey<DataViewState<List>>();
  String _q = '';

  @override
  Widget build(BuildContext context) {
    final api = apiOf(context);
    final canAdd = widget.addScreen != null && widget.addPermission != null && canManage(context, widget.addPermission!);
    return Scaffold(
      appBar: AppBar(title: Text(widget.title)),
      floatingActionButton: canAdd
          ? FloatingActionButton.extended(
              onPressed: () async {
                if (await openEditor(context, widget.addScreen!())) _key.currentState?.reload();
              },
              icon: const Icon(Icons.add),
              label: Text(widget.addLabel ?? t('Add')),
            )
          : null,
      body: Column(children: [
        if (widget.paged)
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
            child: TextField(
              decoration: InputDecoration(hintText: t('Search {what}', {'what': widget.title.toLowerCase()}), prefixIcon: const Icon(Icons.search), isDense: true),
              onSubmitted: (v) {
                _q = v;
                _key.currentState?.reload();
              },
            ),
          ),
        Expanded(
          child: DataView<List>(
            key: _key,
            load: () async => (await api.get(widget.path, {if (widget.paged) 'pageSize': 100, if (widget.paged) 'q': _q}) as Map)['data'] as List,
            builder: (context, items, reload) => items.isEmpty
                ? ListView(children: [EmptyState(icon: widget.emptyIcon, title: t('Nothing here yet'), body: canAdd ? t('Tap “{label}” to create one.', {'label': widget.addLabel ?? t('Add')}) : null)])
                : ListView.separated(
                    padding: const EdgeInsets.fromLTRB(16, 12, 16, 96),
                    itemCount: items.length,
                    separatorBuilder: (_, _) => const SizedBox(height: 10),
                    itemBuilder: (context, i) {
                      final m = items[i] as Map;
                      final page = widget.open?.call(context, m);
                      return widget.item(
                        context,
                        m,
                        page == null
                            ? null
                            : () async {
                                await Navigator.of(context).push(MaterialPageRoute(builder: (_) => page));
                                reload();
                              },
                        reload,
                      );
                    },
                  ),
          ),
        ),
      ]),
    );
  }
}

Widget _sub(String text) => Text(text, style: const TextStyle(fontSize: 12.5, color: AppColors.muted));
Widget _title(String text) => Text(text, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 15));
const _chevron = Icon(Icons.chevron_right, color: AppColors.muted);

class AdminRestaurantsScreen extends StatelessWidget {
  const AdminRestaurantsScreen({super.key});
  @override
  Widget build(BuildContext context) => _ListScreen(
        title: t('Restaurants'),
        path: '/restaurants',
        paged: false,
        emptyIcon: Icons.storefront_outlined,
        addLabel: t('Add restaurant'),
        addPermission: 'restaurants:create',
        addScreen: () => const RestaurantForm(),
        open: (context, r) => RestaurantDetailScreen(id: r['id'].toString()),
        item: (context, r, onTap, _) => AppCard(
          onTap: onTap,
          child: Row(children: [
            const IconChip(Icons.storefront_outlined),
            const SizedBox(width: 12),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                _title(r['name'].toString()),
                _sub('${r['code']} · ${r['city'] ?? ''}'),
                if (r['manager'] != null) _sub(t('Manager: {name}', {'name': personName(r['manager'])})),
              ]),
            ),
            if (r['status'] != 'ACTIVE') StatusBadge(r['status']?.toString()),
            _chevron,
          ]),
        ),
      );
}

class PartsScreen extends StatelessWidget {
  const PartsScreen({super.key});
  @override
  Widget build(BuildContext context) => _ListScreen(
        title: t('Inventory'),
        path: '/parts',
        emptyIcon: Icons.inventory_2_outlined,
        addLabel: t('Add part'),
        addPermission: 'parts:create',
        addScreen: () => const PartForm(),
        open: (context, p) => PartDetailScreen(id: p['id'].toString()),
        item: (context, p, onTap, _) {
          final low = (p['lowCount'] ?? 0) > 0;
          return AppCard(
            onTap: onTap,
            borderColor: low ? AppColors.warning.withValues(alpha: 0.5) : null,
            child: Row(children: [
              IconChip(Icons.settings_input_component_outlined, tone: low ? 'warning' : 'info'),
              const SizedBox(width: 12),
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  _title(p['name'].toString()),
                  _sub('${p['partNumber']} · ${p['category'] ?? ''}'),
                  _sub('${fmtMoney(p['unitCost'])} / ${p['unit']} · ${t('min {n}', {'n': p['minStock']})}'),
                  if (p['preferredVendor'] != null) _sub(t('Vendor: {name}', {'name': (p['preferredVendor'] as Map)['name']})),
                ]),
              ),
              Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
                Text('${p['totalQuantity'] ?? 0}', style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w600)),
                _sub(t('in stock')),
                if (low) ...[const SizedBox(height: 4), Pill(t('Low at {n}', {'n': p['lowCount']}), tone: 'warning')],
              ]),
            ]),
          );
        },
      );
}

class PurchaseOrdersScreen extends StatelessWidget {
  const PurchaseOrdersScreen({super.key});
  @override
  Widget build(BuildContext context) => _ListScreen(
        title: t('Purchase orders'),
        path: '/purchase-orders',
        emptyIcon: Icons.receipt_long_outlined,
        addLabel: t('New order'),
        addPermission: 'purchase_orders:create',
        addScreen: () => const PurchaseOrderForm(),
        open: (context, po) => PurchaseOrderScreen(id: po['id'].toString()),
        item: (context, po, onTap, _) => AppCard(
          onTap: onTap,
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              Text(po['code'].toString(), style: const TextStyle(fontSize: 12.5, color: AppColors.muted)),
              const Spacer(),
              StatusBadge(po['status']?.toString()),
            ]),
            const SizedBox(height: 6),
            _title((po['vendor'] as Map?)?['name']?.toString() ?? ''),
            _sub((po['restaurant'] as Map?)?['name']?.toString() ?? ''),
            const SizedBox(height: 6),
            Row(children: [
              Text(fmtMoney(po['total']), style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 16)),
              const SizedBox(width: 8),
              _sub('· ${t('{n} item(s)', {'n': po['itemCount']})}'),
              const Spacer(),
              Flexible(child: _sub(t('By {name}', {'name': personName(po['requestedBy'])}))),
            ]),
            if (po['expectedAt'] != null) _sub(t('Expected {date}', {'date': fmtDate(po['expectedAt'])})),
          ]),
        ),
      );
}

class VendorsScreen extends StatelessWidget {
  const VendorsScreen({super.key});
  @override
  Widget build(BuildContext context) => _ListScreen(
        title: t('Vendors'),
        path: '/vendors',
        emptyIcon: Icons.local_shipping_outlined,
        addLabel: t('Add vendor'),
        addPermission: 'vendors:create',
        addScreen: () => const VendorForm(),
        open: (context, v) => canManage(context, 'vendors:edit') ? _VendorLoader(id: v['id'].toString()) : null,
        item: (context, v, onTap, _) => AppCard(
          onTap: onTap,
          child: Row(children: [
            const IconChip(Icons.handshake_outlined),
            const SizedBox(width: 12),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                _title(v['name'].toString()),
                _sub([v['contactName'], v['city']].whereType<String>().join(' · ')),
                if (v['email'] != null) _sub(v['email'].toString()),
                _sub(t('{restaurants} restaurants · {orders} open orders',
                    {'restaurants': (v['restaurants'] as List?)?.length ?? 0, 'orders': v['openOrders'] ?? 0})),
              ]),
            ),
            if (v['phone'] != null)
              IconButton(
                icon: const Icon(Icons.call_outlined, color: AppColors.primary),
                onPressed: () => launchUrl(Uri.parse('tel:${v['phone']}')),
              ),
          ]),
        ),
      );
}

/// Loads the full vendor, then shows the edit form.
class _VendorLoader extends StatelessWidget {
  const _VendorLoader({required this.id});
  final String id;
  @override
  Widget build(BuildContext context) {
    final api = apiOf(context);
    return FutureBuilder<Map<String, dynamic>>(
      future: api.getData<Map<String, dynamic>>('/vendors/$id'),
      builder: (context, snap) {
        if (snap.hasError) {
          return Scaffold(appBar: AppBar(), body: ErrorView(error: snap.error!, onRetry: () => Navigator.of(context).pop()));
        }
        if (!snap.hasData) return const Scaffold(body: Center(child: CircularProgressIndicator()));
        return VendorForm(existing: snap.data);
      },
    );
  }
}

class TeamsScreen extends StatelessWidget {
  const TeamsScreen({super.key});
  @override
  Widget build(BuildContext context) => _ListScreen(
        title: t('Teams'),
        path: '/teams',
        paged: false,
        emptyIcon: Icons.groups_outlined,
        addLabel: t('Add team'),
        addPermission: 'teams:create',
        addScreen: () => const TeamForm(),
        open: (context, team) => canManage(context, 'teams:edit') ? TeamForm(existing: team.cast<String, dynamic>()) : null,
        item: (context, team, onTap, _) {
          final members = (team['members'] as List?) ?? const [];
          return AppCard(
            onTap: onTap,
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Row(children: [
                const IconChip(Icons.groups_outlined, brand: true),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    _title(team['name'].toString()),
                    if (team['description'] != null) _sub(team['description'].toString()),
                  ]),
                ),
                if (onTap != null) const Icon(Icons.edit_outlined, size: 18, color: AppColors.muted),
              ]),
              const SizedBox(height: 10),
              _sub('${team['restaurant'] != null ? (team['restaurant'] as Map)['name'] : t('All restaurants')}'
                  '${team['lead'] != null ? ' · ${t('Lead: {name}', {'name': personName(team['lead'])})}' : ''}'),
              const SizedBox(height: 6),
              Wrap(spacing: 6, runSpacing: 6, children: [
                for (final m in members)
                  Chip(
                    avatar: Avatar(m, size: 22),
                    label: Text(personName(m), style: const TextStyle(fontSize: 12.5)),
                    visualDensity: VisualDensity.compact,
                  ),
              ]),
            ]),
          );
        },
      );
}

class DocumentsScreen extends StatelessWidget {
  const DocumentsScreen({super.key});
  @override
  Widget build(BuildContext context) {
    final api = apiOf(context);
    return _ListScreen(
      title: t('Documents'),
      path: '/documents',
      emptyIcon: Icons.description_outlined,
      addLabel: t('Upload'),
      addPermission: 'documents:create',
      addScreen: () => const DocumentForm(),
      item: (context, d, _, reload) {
        final expiry = d['expiry']?.toString();
        final canRemove = (d['can'] as Map?)?['delete'] == true && canManage(context, 'documents:delete');
        final tone = expiry == 'expired' ? 'danger' : expiry == 'expiring' ? 'warning' : 'neutral';
        final pdf = d['mimeType'] == 'application/pdf';
        return AppCard(
          onTap: () => launchUrl(Uri.parse(api.fileUrl(d['url']?.toString())), mode: LaunchMode.externalApplication),
          child: Row(children: [
            IconChip(pdf ? Icons.picture_as_pdf_outlined : Icons.insert_drive_file_outlined, tone: pdf ? 'danger' : 'info'),
            const SizedBox(width: 12),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                _title(d['title'].toString()),
                _sub('${label(d['docType'])} · ${(d['owner'] as Map?)?['name'] ?? ''}'),
                if (d['expiresAt'] != null) _sub(t('Expires {date}', {'date': fmtDate(d['expiresAt'])})),
              ]),
            ),
            if (expiry == 'expired' || expiry == 'expiring') Pill(expiry == 'expired' ? t('Expired') : t('Expiring'), tone: tone),
            const SizedBox(width: 4),
            if (canRemove)
              IconButton(
                tooltip: t('Remove'),
                icon: const Icon(Icons.delete_outline, color: AppColors.dangerFg),
                onPressed: () async {
                  if (!await confirm(context, t('Remove this document?'), action: t('Remove'))) return;
                  if (!context.mounted) return;
                  if (await runAction(context, () => api.delete('/documents/${d['id']}'), success: t('Removed'))) reload();
                },
              )
            else
              const Icon(Icons.open_in_new, size: 18, color: AppColors.muted),
          ]),
        );
      },
    );
  }
}

class UsersScreen extends StatelessWidget {
  const UsersScreen({super.key});
  @override
  Widget build(BuildContext context) => _ListScreen(
        title: t('Users'),
        path: '/users',
        emptyIcon: Icons.people_outline,
        addLabel: t('Add user'),
        addPermission: 'users:create',
        addScreen: () => const UserForm(),
        open: (context, u) => UserDetailScreen(id: u['id'].toString()),
        item: (context, u, onTap, _) => AppCard(
          onTap: onTap,
          child: Row(children: [
            Avatar(u, size: 40),
            const SizedBox(width: 12),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                _title(personName(u)),
                _sub('${(u['role'] as Map?)?['name'] ?? ''}${u['jobTitle'] != null ? ' · ${u['jobTitle']}' : ''}'),
                _sub([u['username'], u['phone']].whereType<String>().join(' · ')),
                _sub(((u['restaurants'] as List?) ?? const []).map((r) => (r as Map)['name']).join(', ')),
              ]),
            ),
            StatusBadge(u['status']?.toString()),
          ]),
        ),
      );
}
