import QtQuick 2.15
import org.kde.plasma.plasmoid 2.0

Item {
    id: root

    Plasmoid.preferredRepresentation: Plasmoid.compactRepresentation
    Plasmoid.compactRepresentation: CompactRepresentation {}
    Plasmoid.fullRepresentation: FullRepresentation {}

    Plasmoid.icon: plasmoid.configuration.icon || "utilities-terminal"
    Plasmoid.title: "CmdBar"
    Plasmoid.toolTipSubTitle: "Quick commands in your KDE Plasma status bar"
}
