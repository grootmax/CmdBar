import QtQuick 2.15
import QtQuick.Layouts 1.15
import org.kde.plasma.core 2.0 as PlasmaCore
import org.kde.plasma.components 3.0 as PlasmaComponents3

MouseArea {
    id: compactRoot
    anchors.fill: parent
    hoverEnabled: true

    PlasmaCore.IconItem {
        id: trayIcon
        anchors.centerIn: parent
        width: Math.min(parent.width, parent.height) * 0.8
        height: width
        source: plasmoid.configuration.icon || "utilities-terminal"
    }

    PlasmaComponents3.ToolTip {
        visible: compactRoot.containsMouse
        text: "CmdBar Quick Commands (Meta+Space)"
    }

    onClicked: {
        plasmoid.expanded = !plasmoid.expanded
    }
}
