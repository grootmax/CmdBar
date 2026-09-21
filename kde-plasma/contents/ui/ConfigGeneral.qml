import QtQuick 2.15
import QtQuick.Controls 2.15
import QtQuick.Layouts 1.15
import org.kde.plasma.core 2.0 as PlasmaCore
import org.kde.plasma.components 3.0 as PlasmaComponents3

Item {
    id: configPage

    property alias cfg_useKWallet: kwalletSwitch.checked
    property alias cfg_globalShortcut: shortcutField.text
    property alias cfg_aiProvider: aiProviderCombo.currentText

    ColumnLayout {
        anchors.fill: parent
        anchors.margins: 16
        spacing: 12

        PlasmaComponents3.Label {
            text: "CmdBar Plasma Preferences"
            font.bold: true
            font.pointSize: 12
        }

        RowLayout {
            PlasmaComponents3.Label {
                text: "Global KWin Shortcut:"
                Layout.preferredWidth: 150
            }
            PlasmaComponents3.TextField {
                id: shortcutField
                text: "Meta+Space"
                Layout.fillWidth: true
            }
        }

        RowLayout {
            PlasmaComponents3.Label {
                text: "Store API Keys in KWallet:"
                Layout.preferredWidth: 150
            }
            PlasmaComponents3.Switch {
                id: kwalletSwitch
                checked: true
            }
        }

        RowLayout {
            PlasmaComponents3.Label {
                text: "Default AI Provider:"
                Layout.preferredWidth: 150
            }
            PlasmaComponents3.ComboBox {
                id: aiProviderCombo
                model: ["OpenAI", "Anthropic", "Ollama"]
                currentIndex: 0
                Layout.fillWidth: true
            }
        }

        Item { Layout.fillHeight: true }
    }
}
