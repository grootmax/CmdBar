import QtQuick 2.15
import QtQuick.Controls 2.15
import QtQuick.Layouts 1.15
import org.kde.plasma.core 2.0 as PlasmaCore
import org.kde.plasma.components 3.0 as PlasmaComponents3
import org.kde.kirigami 2.20 as Kirigami

Item {
    id: fullRoot
    implicitWidth: 480
    implicitHeight: 520

    property string searchText: ""
    property string activeCategory: "All"
    property var commandList: [
        { name: "Git Status", command: "git status", category: "Git" },
        { name: "Git Push", command: "git push origin <branch>", category: "Git", placeholder: "branch" },
        { name: "Build Project", command: "make build", category: "Projects" },
        { name: "Deploy Staging", command: "kubectl rollout restart deployment/api", category: "Infrastructure" },
        { name: "Translate AI", command: "/ai deploy latest build to staging", category: "AI" }
    ]

    ColumnLayout {
        anchors.fill: parent
        anchors.margins: Kirigami.Units.largeSpacing
        spacing: Kirigami.Units.smallSpacing

        // Search Field
        PlasmaComponents3.TextField {
            id: searchInput
            Layout.fillWidth: true
            placeholderText: "Search commands or type /ai prompt..."
            focus: true
            onTextChanged: fullRoot.searchText = text.toLowerCase()
        }

        // Category Filter Row
        RowLayout {
            Layout.fillWidth: true
            spacing: Kirigami.Units.smallSpacing

            PlasmaComponents3.Button {
                text: "All"
                checked: fullRoot.activeCategory === "All"
                onClicked: fullRoot.activeCategory = "All"
            }
            PlasmaComponents3.Button {
                text: "Git"
                checked: fullRoot.activeCategory === "Git"
                onClicked: fullRoot.activeCategory = "Git"
            }
            PlasmaComponents3.Button {
                text: "Projects"
                checked: fullRoot.activeCategory === "Projects"
                onClicked: fullRoot.activeCategory = "Projects"
            }
            PlasmaComponents3.Button {
                text: "Infrastructure"
                checked: fullRoot.activeCategory === "Infrastructure"
                onClicked: fullRoot.activeCategory = "Infrastructure"
            }
            PlasmaComponents3.Button {
                text: "AI"
                checked: fullRoot.activeCategory === "AI"
                onClicked: fullRoot.activeCategory = "AI"
            }
        }

        // Command ListView
        ListView {
            id: listView
            Layout.fillWidth: true
            Layout.fillHeight: true
            clip: true
            model: fullRoot.commandList.filter(function(item) {
                var catMatch = (fullRoot.activeCategory === "All" || item.category === fullRoot.activeCategory);
                var searchMatch = (!fullRoot.searchText || item.name.toLowerCase().indexOf(fullRoot.searchText) >= 0 || item.command.toLowerCase().indexOf(fullRoot.searchText) >= 0);
                return catMatch && searchMatch;
            })

            delegate: Rectangle {
                width: listView.width
                height: 54
                color: mouseArea.containsMouse ? Kirigami.Theme.highlightColor : Kirigami.Theme.backgroundColor
                radius: 4

                RowLayout {
                    anchors.fill: parent
                    anchors.margins: 8
                    spacing: 8

                    ColumnLayout {
                        Layout.fillWidth: true
                        spacing: 2

                        Text {
                            text: modelData.name
                            font.bold: true
                            color: mouseArea.containsMouse ? Kirigami.Theme.highlightedTextColor : Kirigami.Theme.textColor
                        }
                        Text {
                            text: modelData.command
                            font.family: "Monospace"
                            font.pixelSize: 11
                            color: mouseArea.containsMouse ? Kirigami.Theme.highlightedTextColor : Kirigami.Theme.disabledTextColor
                            elide: Text.ElideRight
                        }
                    }

                    PlasmaComponents3.Button {
                        text: "Copy"
                        icon.name: "edit-copy"
                        onClicked: {
                            // Copy command string
                        }
                    }

                    PlasmaComponents3.Button {
                        text: "Run"
                        icon.name: "system-run"
                        highlighted: true
                        onClicked: {
                            // Execute command via D-Bus
                        }
                    }
                }

                MouseArea {
                    id: mouseArea
                    anchors.fill: parent
                    hoverEnabled: true
                    onDoubleClicked: {
                        // Trigger execution
                    }
                }
            }
        }
    }
}
